import { pagesApiJson } from "./cloud";
export async function sendVaultRecoveryOtp(){return pagesApiJson<{ok:boolean;expiresInSeconds:number;resendAfterSeconds:number}>("/password-vault/recovery/send",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})}
export async function verifyVaultRecoveryOtp(code:string){return pagesApiJson<{ok:boolean;verified:boolean}>("/password-vault/recovery/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})})}
