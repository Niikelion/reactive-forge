import {FC} from "react";

enum SomeEnum {
    Val1 = "1",
    Val2 = "test"
}

export const WithEnum: FC<{v: SomeEnum, g: "test" | 2}> = ({v}) => <div>{v}</div>