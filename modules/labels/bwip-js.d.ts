declare module "bwip-js" {
  interface RenderOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    paddingwidth?: number;
    paddingheight?: number;
  }

  const bwipjs: {
    toBuffer(options: RenderOptions): Promise<Buffer>;
  };

  export default bwipjs;
}
