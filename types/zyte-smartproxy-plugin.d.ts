declare module 'zyte-smartproxy-plugin' {
  export interface SmartProxyOptions {
    spm_apikey: string;
    spm_session?: string;
    spm_host?: string;
    static_bypass?: boolean;
    block_ads?: boolean;
    proxy_url?: string;
    [key: string]: unknown;
  }

  const SmartProxyPlugin: (options: SmartProxyOptions) => any;
  export default SmartProxyPlugin;
}
