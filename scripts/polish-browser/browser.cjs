// Select the browser engine without leaking Chromium-only flags into other engines.
const playwright=require(process.env.HH_PLAYWRIGHT_MODULE||'playwright');
const name=process.env.HH_BROWSER||'chromium';
if(!['chromium','firefox','webkit'].includes(name))throw new Error(`Unsupported HH_BROWSER: ${name}`);
exports.launchBrowser=()=>playwright[name].launch({headless:true,...(name==='chromium'?{
  args:['--disable-background-networking'],
  ...(process.env.HH_CHROMIUM_EXECUTABLE?{executablePath:process.env.HH_CHROMIUM_EXECUTABLE}:{})
}:{})});
