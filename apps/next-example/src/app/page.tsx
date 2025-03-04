"use client"
import {ComponentLibraryProvider, ComponentRenderer, Construct, useComponentPreview} from "@reactive-forge/ui";
import {components} from "../../reactive-forge";
import {FC} from "react";

const ComponentPreview: FC<{ path: string, name: string }> = ({ path, name }) => {
    const preview = useComponentPreview(path, name)
    if (preview === null) return null
    const { editorProps, rendererProps } = preview
    
    return <div>
        <Construct {...editorProps} />
        {rendererProps !== null && <ComponentRenderer {...rendererProps} />}
    </div>
}

export default function Home() {
    return (
        <div style={{ padding: "20px" }}>
            <ComponentLibraryProvider components={components}>
                <ComponentPreview path="@/components/Button" name="Button"/>
            </ComponentLibraryProvider>
        </div>
    )
}
