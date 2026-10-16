const path=require('node:path');
module.exports=process.env.PROJECTDESK_PLAYWRIGHT_MODULE?require(path.resolve(process.env.PROJECTDESK_PLAYWRIGHT_MODULE)):require('playwright');
