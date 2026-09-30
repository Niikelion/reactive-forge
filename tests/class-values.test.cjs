const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const {Project, ts} = require('ts-morph');
const schema = require('../packages/schema/src/index.ts');
const runtime = require('../packages/runtime/src/index.ts');
const {extractComponents} = require('../packages/codegen/src/extract.ts');
const {generateFiles} = require('../packages/codegen/src/generate.ts');
const {buildProps} = require('../packages/codegen/src/metadataProps.ts');
const {Price, Money, moneyAdapter} = require('./fixtures/class-values/values.ts');
const {renderToStaticMarkup} = require('react-dom/server');
schema.registerCommonSchemas();
const root = path.resolve(__dirname, '..');
const file = path.join(__dirname, 'fixtures/class-values/values.ts');
const payloadSchema = {type:'object',properties:{amount:{schema:{type:'number'},required:true},currency:{schema:{type:'string'},required:true}}};
const binding = {type:{module:'./tests/fixtures/class-values/values',exportName:'Money'},id:'test/Money',version:1,payloadSchema,runtime:{module:'./tests/fixtures/class-values/values',exportName:'moneyAdapter'}};
const project = new Project({compilerOptions:{strict:true,target:ts.ScriptTarget.ES2022,moduleResolution:ts.ModuleResolutionKind.NodeJs}});
project.addSourceFileAtPath(file);
const components = extractComponents(project, [file], {rootDir:root,classBindings:[binding]});
const price = components.find(c=>c.name==='Price');
const meta = {id:'price',name:'Price',sourcePath:'values.ts',isDefault:false,props:buildProps(price),diagnostics:[]};
const metadata = {schemaVersion:3,generatedAt:'test',components:[meta]};
const library = {files:[{path:'values.ts',components:{Price:{id:'price',component:Price,args:{}}}}],valueAdapters:{'test/Money':moneyAdapter}};
const instance = (adapterId, value, version=1)=>({type:'instance',adapterId,version,value});
const string = value=>({type:'string',value});
const money = instance('test/Money',{type:'object',value:{amount:{type:'number',value:1250},currency:string('EUR')}});
const leaf = value=>({kind:'composed',value:{kind:'leaf',value}});
const document = {schemaVersion:4,root:{kind:'instance',instanceId:'root',componentId:'price',props:{money:leaf(money),url:leaf(instance('builtin/URL',string('https://example.com/a'))),at:leaf({type:'date',value:'2026-09-30T14:23:12.456Z'})}}};

test('class extraction preserves identity and binding; Date subclasses and constructors are not flattened',()=>{
  assert.equal(meta.props.money.schema.type,'instance');
  assert.equal(meta.props.url.schema.adapter.id,'builtin/URL');
  assert.equal(meta.props.at.schema.type,'date');
  const unsupported = components.find(c=>c.name==='Unsupported');
  assert.equal(unsupported.args.date.schema.name,'instance');
  assert.ok(unsupported.propMeta.date.diagnostics.some(d=>d.code==='missing-class-adapter'));
  assert.ok(unsupported.propMeta.constructorRef.diagnostics.some(d=>d.code==='unsupported-constructor-reference'));
});
test('generic specializations, reexports and shadowed built-in names retain class identity',()=>{
  const p=new Project({compilerOptions:{strict:true,target:ts.ScriptTarget.ES2022,moduleResolution:ts.ModuleResolutionKind.NodeJs}});
  const source=p.createSourceFile(path.join(root,'tests/__class_generic.ts'),`import {createElement} from 'react';
    export class Box<T> { constructor(public value:T) {} }
    class Date { value=1 }
    export function Generic(props:{box:Box<number>; other:Box<string>; date:Date}) {return createElement('span');}`);
  p.createSourceFile(path.join(root,'tests/__class_barrel.ts'),`export {Box as Crate} from './__class_generic';`);
  const bindings=[{type:{module:'./tests/__class_barrel',exportName:'Crate'},id:'test/NumberBox',version:1,typeArguments:[{type:'number'}],payloadSchema:{type:'number'},runtime:{module:'./unused',exportName:'adapter'}}];
  const c=extractComponents(p,[source.getFilePath()],{rootDir:root,classBindings:bindings}).find(c=>c.name==='Generic');
  assert.equal(c.args.box.schema.adapter.id,'test/NumberBox');
  assert.deepEqual(c.args.box.schema.typeArguments.map(s=>s.toJson()),[{type:'number'}]);
  assert.equal(c.args.other.schema.adapter,undefined);
  assert.equal(c.args.date.schema.name,'instance');
  assert.equal(c.args.date.schema.typeRef.kind,'project');
});
test('Date validation rejects invalid values and instance values roundtrip without construction',()=>{
  assert.throws(()=>schema.fromValueJson(schema.DateSchema.instance,{type:'date',value:'invalid'}));
  const parsed=schema.schemaFromJson(meta.props.money.schema);
  assert.deepEqual(schema.toValueJson(schema.fromValueJson(parsed,money)),money);
  assert.throws(()=>schema.fromValueJson(parsed,{...money,version:2}));
});
test('preview constructs real Money with private state and URL; validation does not call constructor',()=>{
  const validating={...library,valueAdapters:{'test/Money':{...moneyAdapter,fromData:()=>{throw Error('constructed during validation')}}}};
  assert.equal(runtime.validateComposition(document,metadata,validating).valid,true);
  const element=runtime.renderComposition(document,metadata,library);
  assert.ok(element.props.money instanceof Money);
  assert.ok(element.props.url instanceof URL);
  assert.equal(renderToStaticMarkup(element),'<span>EUR 12.5 example.com 2026-09-30T14:23:12.456Z</span>');
});
test('constructor failures carry a prop path and missing export factories refuse export',()=>{
  const broken={...library,valueAdapters:{'test/Money':{...moneyAdapter,fromData(){throw Error('factory rejected')}}}};
  assert.throws(()=>runtime.renderComposition(document,metadata,broken),error=>error.diagnostics?.some(d=>d.code==='value-construction-failed' && d.path.includes('money')));
  assert.throws(()=>runtime.exportToTsx(document,metadata,{...library,valueAdapters:{'test/Money':{...moneyAdapter,export:undefined}}}),/no export factory/);
});
test('missing adapters, wrong class/version, invalid payload and old document versions fail clearly',()=>{
  assert.equal(runtime.validateComposition(document,metadata,{...library,valueAdapters:{}}).valid,false);
  assert.equal(runtime.validateComposition(document,metadata,{...library,valueAdapters:{'test/Money':{...moneyAdapter,typeRef:{kind:'builtin',name:'URL'}}}}).valid,false);
  for (const value of [{...money,version:2},{...money,value:{type:'object',value:{amount:{type:'number',value:-1},currency:string('EUR')}}}]) {
    const doc=structuredClone(document); doc.root.props.money=leaf(value);
    assert.equal(runtime.validateComposition(doc,metadata,library).valid,false);
  }
  assert.equal(runtime.validateComposition({...document,schemaVersion:3},metadata,library).valid,false);
});
test('nested class payloads validate and reconstruct through arrays and objects',()=>{
  const nestedSchema=new schema.ObjectSchema({items:{schema:new schema.ArraySchema([],schema.schemaFromJson(meta.props.money.schema)),required:true}});
  const value={type:'object',value:{items:{type:'array',value:[money]}}};
  runtime.validateAdapterValue(nestedSchema,value,library.valueAdapters);
  assert.ok(runtime.decodeAdapterValue(value,library.valueAdapters).items[0] instanceof Money);
});
test('URL serializes through its adapter and unknown schemas cannot smuggle class values',()=>{
  const urlSchema=schema.schemaFromJson(meta.props.url.schema);
  const encoded=runtime.encodeAdapterValue(urlSchema,new URL('https://example.com/a'));
  assert.deepEqual(encoded,instance('builtin/URL',string('https://example.com/a')));
  assert.deepEqual(runtime.encodeAdapterValue(schema.schemaFromJson(meta.props.money.schema),new Money(1250,'EUR'),library.valueAdapters),money);
  assert.throws(()=>runtime.encodeAdapterValue(schema.schemaFromJson(meta.props.money.schema),new Money(1,'EUR'),{'test/Money':{...moneyAdapter,toData:undefined}}),/cannot serialize/);
  assert.throws(()=>runtime.validateAdapterValue(new schema.UnknownSchema(),{type:'object',value:{hidden:money}},library.valueAdapters),/explicit instance schema/);
});
test('class editor exposes payload fields and Date control preserves the complete UTC instant',()=>{
  const React=require('react');
  const editor=require('../packages/editor/src/index.ts');
  const markup=renderToStaticMarkup(React.createElement(editor.PropControl,{propMeta:meta.props.money,currentValue:leaf(money),onChange(){}}));
  assert.match(markup,/amount/);assert.match(markup,/currency/);assert.doesNotMatch(markup,/#amount/);
  let changed;
  const input=editor.DateControl({schema:{type:'date'},currentValue:document.root.props.at,onChange:v=>{changed=v}});
  assert.equal(input.props.value,'2026-09-30T14:23:12.456');
  input.props.onChange({target:{value:'2026-10-01T14:23:12.456'}});
  assert.equal(changed.value.value.value,'2026-10-01T14:23:12.456Z');
  const union={...meta.props.money,schema:{type:'union',types:[meta.props.money.schema,meta.props.url.schema]}};
  const unionMarkup=renderToStaticMarkup(React.createElement(editor.PropControl,{propMeta:union,currentValue:document.root.props.url,onChange(){}}));
  assert.match(unionMarkup,/value="1" selected/);
});
test('TSX export compiles and renders the same class values as preview',async()=>{
  const esbuild=require('esbuild');
  const source=runtime.exportToTsx(document,metadata,library);
  const result=await esbuild.build({stdin:{contents:source,loader:'tsx',resolveDir:path.dirname(file)},jsx:'automatic',bundle:true,write:false,platform:'node',format:'cjs',external:['react','react-dom','@reactive-forge/runtime']});
  const m={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);
  const React=require('react');
  assert.equal(renderToStaticMarkup(React.createElement(m.exports.default,{callbacks:{}})),renderToStaticMarkup(runtime.renderComposition(document,metadata,library)));
});
test('generated registry includes adapter dependencies and metadata version 3',async()=>{
  const outDir=await fs.mkdtemp(path.join(root,'.cache-forge-test-classes-'));
  try {
    await generateFiles(project,[price],{outDir,rootDir:root,baseDir:root,pathPrefix:'',classBindings:[binding]},{info(){}});
    const generated=JSON.parse(await fs.readFile(path.join(outDir,'metadata.json'),'utf8'));
    assert.equal(generated.schemaVersion,3);
    const source=await fs.readFile(path.join(outDir,'index.ts'),'utf8');
    assert.match(source,/valueAdapters/);
    assert.match(source,/moneyAdapter/);
    const result=await require('esbuild').build({entryPoints:[path.join(outDir,'index.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['react']});
    const m={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);
    assert.equal(m.exports.components.valueAdapters['test/Money'].fromData({amount:100,currency:'USD'}).format(),'USD 1');
  } finally {assert.equal(path.dirname(outDir),root);await fs.rm(outDir,{recursive:true,force:true});}
});

test('Map, Set and RegExp extract, serialize, reconstruct and export with generic payload validation',async()=>{
  const collection=components.find(c=>c.name==='Collections');
  const props=buildProps(collection);
  assert.equal(props.prices.schema.adapter.id,'builtin/Map');
  assert.equal(props.tags.schema.adapter.id,'builtin/Set');
  assert.equal(props.pattern.schema.adapter.id,'builtin/RegExp');
  const pattern=/a+/gi;pattern.lastIndex=3;
  const values={prices:new Map([['a',new Money(1250,'EUR')]]),tags:new Set(['one','two']),pattern};
  const cm={id:'collections',name:'Collections',sourcePath:'values.ts',isDefault:false,diagnostics:[],props};
  const md={...metadata,components:[cm]};
  const lib={...library,files:[{path:'values.ts',components:{Collections:{id:cm.id,args:{},component:require('./fixtures/class-values/values.ts').Collections}}}]};
  const encoded=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,leaf(runtime.encodeAdapterValue(schema.schemaFromJson(props[key].schema),value,library.valueAdapters))]));
  const doc={schemaVersion:4,root:{kind:'instance',instanceId:'collections-root',componentId:cm.id,props:encoded}};
  const element=runtime.renderComposition(doc,md,lib);
  assert.ok(element.props.prices instanceof Map);
  assert.ok(element.props.prices.get('a') instanceof Money);
  assert.deepEqual([...element.props.tags],['one','two']);
  assert.equal(element.props.pattern.lastIndex,3);
  assert.equal(element.props.pattern.flags,'gi');
  const source=runtime.exportToTsx(doc,md,lib);
  const result=await require('esbuild').build({stdin:{contents:source,loader:'tsx',resolveDir:path.dirname(file)},jsx:'automatic',bundle:true,write:false,platform:'node',format:'cjs',external:['react','@reactive-forge/runtime']});
  const m={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);
  assert.equal(renderToStaticMarkup(require('react').createElement(m.exports.default,{callbacks:{}})),renderToStaticMarkup(element));
  const mapSchema=schema.schemaFromJson(props.prices.schema);
  assert.throws(()=>runtime.encodeAdapterValue(mapSchema,new Map([[1,new Money(1,'EUR')]]),library.valueAdapters));
  assert.throws(()=>runtime.encodeAdapterValue(schema.schemaFromJson(props.tags.schema),new Set([1])));
  for(const invalid of [{source:'[',flags:'',lastIndex:0},{source:'a',flags:'gg',lastIndex:0},{source:'a',flags:'g',lastIndex:-1}]) {
    assert.throws(()=>runtime.regexpFromData(invalid));
  }
  assert.throws(()=>runtime.mapFromData([['key']]));
  assert.throws(()=>runtime.setFromData({}));
  assert.deepEqual([...runtime.mapFromData([['x',1],['x',2]])],[['x',2]]);
  assert.deepEqual([...runtime.setFromData(['x','x'])],['x']);
});
