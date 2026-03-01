import { Schema } from "@/schema/Schema";
import {equals} from "@/schema/equality";
import {intersect} from "@/schema/intersection";

export function isAssignableTo(a: Schema, b: Schema): boolean {
    return equals(intersect(a, b), b)
}