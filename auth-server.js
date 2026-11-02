import { createOAuthApp, readConfig } from './lib/oauth-app.js';
const config=readConfig();
const port=Number(process.env.PORT||3100);
createOAuthApp(config).listen(port,process.env.HOST||'0.0.0.0',()=>{
  console.log(`GitHub administrator service listening on port ${port}`);
  console.log(config.configured?'OAuth configuration is ready.':'Initial OAuth configuration is required. Open /setup.');
});
