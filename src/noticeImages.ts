export const noticeImageBucket='hh-notice-images';
export const noticeImageMaxBytes=5*1024*1024;

const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as const;

export function noticeImageExtension(mime:string){
 return Object.hasOwn(extensions,mime)?extensions[mime as keyof typeof extensions]:undefined;
}

export function isNoticeImagePath(path:unknown,noticeId:string):path is string{
 return typeof path==='string'&&path.startsWith(`${noticeId}/`)
  &&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/artwork\.(jpg|png|webp)$/.test(path);
}
