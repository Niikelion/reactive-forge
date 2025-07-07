import {styled} from "../../styled-system/jsx";

export const Button = styled("button", {
    base: {
        "--color": "red",
        borderRadius: "4px"
    },
    variants: {
        variant: {
            filled: {
                bg: "var(--color)"
            },
            outlined: {
                bg: "transparent",
                border: "1px solid var(--color)"
            }
        }
    }
})