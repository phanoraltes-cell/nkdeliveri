import { ApplicationServerKeys } from '@block65/webcrypto-web-push';
const k = await ApplicationServerKeys.generate();
console.log(JSON.stringify(await k.toJSON()));
