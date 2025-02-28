import {createContext, FC, ReactNode, useContext} from "react";
import {ComponentFile, ComponentLibrary} from "@reactive-forge/shared";

const Empty: FC = () => <div/>

const componentLibraryContext = createContext<ComponentLibrary>(new ComponentLibrary(
    new ComponentFile("$", {
        Empty: { component: Empty, args: {} }
    })
))

function mergeLibraries(...libraries: ComponentLibrary[]): ComponentLibrary
{
    return new ComponentLibrary(...libraries.map(l => l.listFiles()).flat())
}

export const ComponentLibraryProvider: FC<{ children?: ReactNode, components:  ComponentLibrary | ComponentLibrary[] }> = ({ components, children }) => {
    const parentLibrary = useContext(componentLibraryContext)

    return <componentLibraryContext.Provider value={mergeLibraries(parentLibrary, ...Array.isArray(components) ? components : [components])}>
        {children}
    </componentLibraryContext.Provider>
}

export const useComponentLibrary = () => useContext(componentLibraryContext)