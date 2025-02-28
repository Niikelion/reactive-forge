import {createContext, useContext} from "react";
import * as components from "./Inputs";

const editorComponentsContext = createContext(components)

export const EditorComponentsProvider = editorComponentsContext.Provider

export const useEditorComponents = () => useContext(editorComponentsContext)