import {validMailAddress} from './message.ts';
type Connection={read:(buffer:Uint8Array)=>Promise<number|null>;write:(buffer:Uint8Array)=>Promise<number>;close:()=>void};
type Mail={from:string;to:string;password:string;deliveryId:string;subject:string;text:string;html:string};
const encoder=new TextEncoder();
const base64=(value:string)=>btoa(Array.from(encoder.encode(value),b=>String.fromCharCode(b)).join(''));
const folded=(value:string)=>base64(value).match(/.{1,76}/g)?.join('\r\n')||'';
export async function sendGmail(mail:Mail,connect:()=>Promise<Connection>=()=>Deno.connectTls({hostname:'smtp.gmail.com',port:465}),timeoutMs=15000){
 if(!validMailAddress(mail.from)||!validMailAddress(mail.to)||!/^[a-f0-9-]{36}$/.test(mail.deliveryId)||/[\r\n]/.test(mail.subject)||!mail.password||/[\r\n\0]/.test(mail.password))throw Error('Invalid email settings');
 let connection:Connection|undefined,finished=false,timer:ReturnType<typeof setTimeout>|undefined;
 const run=async()=>{
  const opened=await connect();if(finished){opened.close();throw Error('Email connection timed out')};connection=opened;
  let buffered='';const decoder=new TextDecoder();
  async function line(){for(;;){const end=buffered.indexOf('\r\n');if(end>=0){const value=buffered.slice(0,end);buffered=buffered.slice(end+2);return value}if(buffered.length>32768)throw Error('Invalid mail server response');const bytes=new Uint8Array(2048),count=await opened.read(bytes);if(count===null)throw Error('Mail server disconnected');buffered+=decoder.decode(bytes.subarray(0,count),{stream:true})}}
  async function expect(code:number){for(let i=0;i<100;i++){const value=await line();if(!/^\d{3}[ -]/.test(value)||Number(value.slice(0,3))!==code)throw Error('Mail server did not accept the request');if(value[3]===' ')return}throw Error('Invalid mail server response')}
  async function write(value:string){const bytes=encoder.encode(value);let offset=0;while(offset<bytes.length){const count=await opened.write(bytes.subarray(offset));if(count<=0)throw Error('Mail server disconnected');offset+=count}}
  async function command(value:string,code:number){await write(value+'\r\n');await expect(code)}
  await expect(220);await command('EHLO hh-family',250);
  await command('AUTH PLAIN '+base64('\0'+mail.from+'\0'+mail.password),235);
  await command('MAIL FROM:<'+mail.from+'>',250);await command('RCPT TO:<'+mail.to+'>',250);await command('DATA',354);
  const boundary='hh-'+mail.deliveryId;
  const data=[`From: HH Family <${mail.from}>`,`To: <${mail.to}>`,`Subject: ${mail.subject}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <hh-invite-${mail.deliveryId}@${mail.from.split('@')[1]}>`,'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',folded(mail.text),`--${boundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',folded(mail.html),`--${boundary}--`,''].join('\r\n');
  await write(data.replace(/(^|\r\n)\./g,'$1..')+'\r\n.\r\n');await expect(250);
  // Once DATA is accepted, a QUIT failure must not turn success into a retry.
 };
 try{await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{try{connection?.close()}catch{}reject(Error('Email connection timed out'))},timeoutMs)})])}
 finally{finished=true;if(timer)clearTimeout(timer);try{connection?.close()}catch{}}
}
