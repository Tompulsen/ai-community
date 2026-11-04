/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = fs.mkdtempSync(path.join(tmpdir(), 'community-auth-test-'));
try {
const stub = `
export const Inject=()=>()=>{}; export const Injectable=()=>target=>target;
export const bindThis=()=>{}; export const DI={};
export const IsNull=()=>null; export const LessThanOrEqual=x=>x;
export const Raw=(fn,params)=>({sql:fn('email'),params});
export const getIpHash=x=>x; export const L_CHARS='abc'; export const secureRndstr=()=> 'random';
export class FastifyReplyError extends Error { constructor(status,message){super(message);this.status=status;} }
export class IdService{}; export class WebAuthnService{}; export class UserAuthService{};
export class CaptchaService{}; export class LoggerService{}; export class RateLimiterService{};
export class SigninService{}; export class SignupService{}; export class UserEntityService{};
export class EmailService{}; export class MiLocalUser{};
export default {compare:async(password,hash)=>hash==='hashed:'+password,genSalt:async()=>'',hash:async p=>'hashed:'+p};
`;
const targets = ['SigninApiService','SignupApiService'];
for (const target of targets) {
  await build({entryPoints:[path.join(root,`packages/backend/src/server/api/${target}.ts`)],bundle:true,platform:'node',format:'esm',outfile:path.join(output,target+'.mjs'),tsconfigRaw:{compilerOptions:{experimentalDecorators:true}},plugins:[{name:'test-dependencies',setup(b){b.onResolve({filter:/^(@\/|@nestjs\/|typeorm$|bcryptjs$|\.\/)/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:stub,loader:'js'}));}}]});
}
const { SigninApiService } = await import(pathToFileURL(path.join(output, 'SigninApiService.mjs')));
const { SignupApiService } = await import(pathToFileURL(path.join(output, 'SignupApiService.mjs')));
function reply(){return {status:200,header(){return this;},code(value){this.status=value;return this;}};}
const user = {id:'u1',username:'alice',host:null,isSuspended:false};
const profile = {userId:'u1',password:'hashed:secret',twoFactorEnabled:false};
let lookups=0, query=null, failures=0;
const signin = Object.assign(Object.create(SigninApiService.prototype), {
 config:{url:'https://example.test',enableIpRateLimit:false},meta:{},
 userProfilesRepository:{findOneBy:async q=>{lookups++;query=q;return profile;},findOneByOrFail:async()=>profile},
 usersRepository:{findOneBy:async()=>user},userSecurityKeysRepository:{countBy:async()=>0},
 signinsRepository:{insert:async()=>{failures++;}},idService:{gen:()=> 'history'},
 signinService:{signin:async()=>({finished:true,id:user.id,i:'test-session'})},
 userAuthService:{twoFactorAuthenticate:async(_p,t)=>{if(t!=='123456')throw new Error('invalid');}},
});
const request = body=>({body,ip:'127.0.0.1',headers:{}});
assert.deepEqual(await signin.signin(request({username:'UNKNOWN@example.test'}),reply()),{finished:false,next:'captcha'});
assert.equal(lookups,0,'email preflight must not query account');
assert.equal((await signin.signin(request({username:' Alice@Example.Test ',password:'secret'}),reply())).finished,true);
assert.equal(query.email.params.email,'alice@example.test');
let res=reply();await signin.signin(request({username:'alice@example.test',password:'wrong'}),res);assert.equal(res.status,403);assert.equal(failures,1);
assert.equal((await signin.signin(request({username:'alice',password:'secret'}),reply())).finished,true);
profile.twoFactorEnabled=true;
assert.equal((await signin.signin(request({username:'alice@example.test',password:'secret'}),reply())).next,'totp');
assert.equal((await signin.signin(request({username:'alice@example.test',password:'secret',token:'123456'}),reply())).finished,true);
res=reply();await signin.signin(request({username:'alice@example.test',password:'secret',token:'000000'}),res);assert.equal(res.status,403);
console.log('PASS: email normalization, anonymous preflight privacy, wrong-password rejection, username compatibility, MFA challenge/success/failure.');

let created=0, saved=null;
const signup = Object.assign(Object.create(SignupApiService.prototype), {
 meta:{rootUserId:'admin',emailRequiredForSignup:false,disableRegistration:false},
 userEntityService:{validateLocalUsername:x=>typeof x==='string'&&/^[a-z0-9_]{1,20}$/i.test(x),validatePassword:x=>typeof x==='string'&&x.length>0,pack:async()=>({id:'new'})},
 emailService:{validateEmailForAccount:async email=>({available:email==='new@example.test'})},
 signupService:{signup:async args=>{created++;saved=args;return {account:{id:'new'},secret:'test-session'};}},
});
for (const password of [undefined,null,42,'']) {
 await assert.rejects(signup.signup(request({username:'new',password,emailAddress:'new@example.test'}),reply()),e=>e.status===400);
}
assert.equal(created,0);
res=reply();await signup.signup(request({username:'new',password:'secret'}),res);assert.equal(res.status,400);assert.equal(created,0);
await signup.signup(request({username:'new',password:'secret',emailAddress:' New@Example.Test '}),reply());
assert.equal(saved.email,'new@example.test');assert.equal(saved.emailVerified,undefined);assert.equal(created,1);
console.log('PASS: malformed/missing credentials and missing email rejected; unverified normalized email passed into signup transaction.');


} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
