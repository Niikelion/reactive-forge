import js from "@eslint/js"
import tsEslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

export default tsEslint.config(
    { ignores: ['dist'] },
    {
        extends: [js.configs.recommended, ...tsEslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks
        },
        rules: reactHooks.configs.recommended.rules
    }
)
