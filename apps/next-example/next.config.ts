import type { NextConfig } from "next";
import { withReactiveForge } from "@reactive-forge/next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withReactiveForge({
    componentRoots: [ "src/components" ],
    baseDir: "src"
})(nextConfig);
