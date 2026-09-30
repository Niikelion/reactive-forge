// Fourth fixture component: proves the asset-loader closure (esbuild
// "file" loader for images/fonts, see packages/codegen/src/bundle.ts's
// assetLoaders). Imports a genuine binary PNG directly (exercising the
// plain-`import`-of-an-asset path) and a real CSS file that itself
// references both that same PNG (via background-image url()) and a real
// TTF font (via @font-face url()) - so both a JS-level asset import and a
// CSS-url()-rewritten asset import get exercised by one component. Kept
// minimal: this is a pipeline proof, not a design showcase.
import "./Branded.css"
import logo from "./logo.png"

export interface BrandedProps {
    label: string
}

export const Branded = ({ label }: BrandedProps) => (
    <div data-testid="branded" className="branded">
        <img data-testid="branded-logo" src={logo} alt="" width={1} height={1} />
        <span data-testid="branded-label">{label}</span>
    </div>
)
