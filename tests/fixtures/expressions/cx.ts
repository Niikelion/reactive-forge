/** Joins the class names that are present. A stand-in for any host helper such as clsx. */
export function cx(...names: (string | undefined)[]): string {
    return names.filter(name => name !== undefined && name !== "").join(" ")
}
