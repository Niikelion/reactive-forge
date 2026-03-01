import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import * as reactHooks from "eslint-plugin-react-hooks"

export const eslintConfig = tseslint.config(
    { ignores: ['dist'] },
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    reactHooks.configs["recommended-latest"],
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ["*.config.ts"]
                }
            }
        }
    }
)
