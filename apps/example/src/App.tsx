import './App.css'
import {ComponentLibraryProvider, ComponentRenderer} from "@reactive-forge/ui"
import {components} from "../reactive-forge";
import {c} from "@reactive-forge/ui";
import {ComponentContextProvider} from "@reactive-forge/ui";
import {JSX} from "react";

function App(): JSX.Element {
    return (
        <ComponentLibraryProvider components={components}>
            <ComponentContextProvider>
                <ComponentRenderer path="@/Test" name="Test" args={{ title: c.string("Some title") }} />
                <ComponentRenderer path="@/Row" name="Row" args={{
                    children: c.array([1, 2, 3].map(n => c.element("@/Test", "Test", { title: c.string(`Elem ${n}`) })))
                }} />
            </ComponentContextProvider>
        </ComponentLibraryProvider>
    )
}

export default App
