// A component whose sole parameter is not an object type at all (a plain
// string), exercising the "props-not-object" diagnostic code.
export const BadProps = (title: string) => <div>{title}</div>;
