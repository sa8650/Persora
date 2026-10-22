export type VaultEntry = { id:string; title:string; login:string; password:string; url:string; notes:string; questions:{question:string;answer:string}[]; folder:string; favorite:boolean; pinned:boolean; updated:number; trash?:{deletedAt:number;expiresAt:number} };
export type VaultEnvelopeV2 = {version:2; kdf:"PBKDF2-SHA-256"; iterations:number; masterSalt:string; recoverySalt:string; dataIv:string; dataCiphertext:string; masterIv:string; masterWrap:string; recoveryIv:string; recoveryWrap:string};
const ITERATIONS=310000;
const encoder=new TextEncoder();
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const un64=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const random=(n:number)=>crypto.getRandomValues(new Uint8Array(n));
async function aesKey(raw:Uint8Array, usages:KeyUsage[]){return crypto.subtle.importKey("raw",new Uint8Array(raw).buffer,"AES-GCM",false,usages)}
async function masterKey(password:string,salt:Uint8Array){const material=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt:new Uint8Array(salt).buffer,iterations:ITERATIONS},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function recoveryKey(raw:Uint8Array,salt:Uint8Array){const base=await crypto.subtle.importKey("raw",new Uint8Array(raw).buffer,"HKDF",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:new Uint8Array(salt).buffer,info:encoder.encode("persora-password-vault-recovery-v1")},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function encrypt(key:CryptoKey,data:BufferSource){const iv=random(12);const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv:new Uint8Array(iv).buffer},key,data);return {iv:b64(iv),cipher:b64(new Uint8Array(encrypted))}}
async function decrypt(key:CryptoKey,iv:string,cipher:string){return crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(un64(iv)).buffer},key,new Uint8Array(un64(cipher)).buffer)}
export function generateRecoveryKey(){return b64(random(32)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
export async function createVault(entries:VaultEntry[],password:string,recoveryText=generateRecoveryKey()):Promise<{envelope:VaultEnvelopeV2;recoveryKey:string}>{
 const dek=random(32),masterSalt=random(16),recoverySalt=random(16);const m=await masterKey(password,masterSalt),r=await recoveryKey(unb64url(recoveryText),recoverySalt),data=await aesKey(dek,["encrypt"]),masterWrap=await encrypt(m,dek),recoveryWrap=await encrypt(r,dek),payload=await encrypt(data,encoder.encode(JSON.stringify(entries)));
 return {envelope:{version:2,kdf:"PBKDF2-SHA-256",iterations:ITERATIONS,masterSalt:b64(masterSalt),recoverySalt:b64(recoverySalt),dataIv:payload.iv,dataCiphertext:payload.cipher,masterIv:masterWrap.iv,masterWrap:masterWrap.cipher,recoveryIv:recoveryWrap.iv,recoveryWrap:recoveryWrap.cipher},recoveryKey:recoveryText};
}
function unb64url(text:string){const t=text.replace(/-/g,"+").replace(/_/g,"/");return un64(t+"=".repeat((4-t.length%4)%4))}
async function entriesWithDek(env:VaultEnvelopeV2,dekRaw:ArrayBuffer):Promise<VaultEntry[]>{const dek=await aesKey(new Uint8Array(dekRaw),["decrypt"]);return JSON.parse(new TextDecoder().decode(await decrypt(dek,env.dataIv,env.dataCiphertext))) as VaultEntry[]}
export async function unlockVault(raw:string,password:string):Promise<{entries:VaultEntry[];envelope:VaultEnvelopeV2|null}>{
 const parsed=JSON.parse(raw);
 if(parsed.version===2){const dek=await decrypt(await masterKey(password,un64(parsed.masterSalt)),parsed.masterIv,parsed.masterWrap);return {entries:await entriesWithDek(parsed,dek),envelope:parsed}}
 // Legacy v1 uses a PBKDF2 key directly on the entire ciphertext. Only a valid old password can migrate it.
 const key=await masterKey(password,un64(parsed.salt));const plain=await decrypt(key,parsed.iv,parsed.cipher);return {entries:JSON.parse(new TextDecoder().decode(plain)),envelope:null};
}
export async function recoverVault(raw:string,recoveryText:string):Promise<VaultEntry[]>{const env=JSON.parse(raw) as VaultEnvelopeV2;if(env.version!==2)throw new Error("This vault has not completed recovery-key setup.");const dek=await decrypt(await recoveryKey(unb64url(recoveryText),un64(env.recoverySalt)),env.recoveryIv,env.recoveryWrap);return entriesWithDek(env,dek)}
export async function rewrapMaster(raw:string,recoveryText:string,newPassword:string):Promise<VaultEnvelopeV2>{const env=JSON.parse(raw) as VaultEnvelopeV2;if(env.version!==2)throw new Error("This vault has not completed recovery-key setup.");const dek=await decrypt(await recoveryKey(unb64url(recoveryText),un64(env.recoverySalt)),env.recoveryIv,env.recoveryWrap);const masterSalt=random(16),wrap=await encrypt(await masterKey(newPassword,masterSalt),dek);return {...env,masterSalt:b64(masterSalt),masterIv:wrap.iv,masterWrap:wrap.cipher}}
export async function encryptEntries(env:VaultEnvelopeV2,entries:VaultEntry[],password:string):Promise<VaultEnvelopeV2>{const dek=await decrypt(await masterKey(password,un64(env.masterSalt)),env.masterIv,env.masterWrap);const key=await aesKey(new Uint8Array(dek),["encrypt"]);const payload=await encrypt(key,encoder.encode(JSON.stringify(entries)));return {...env,dataIv:payload.iv,dataCiphertext:payload.cipher}}
