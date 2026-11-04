import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {categoryKeys} from '../public/categories.js';

export function buildInfo(){
  const hash=createHash('sha256');
  for(const path of ['public/admin.html','public/admin.js','public/admin.css','public/shared.js','public/catalog.js','public/categories.js','public/html-file.js','lib/github-repository.js']){
    hash.update(path).update('\0').update(readFileSync(new URL('../'+path,import.meta.url)));
  }
  const revision=process.env.RENDER_GIT_COMMIT;
  return {uiVersion:hash.digest('hex').slice(0,16),revision:/^[a-f0-9]{40}$/i.test(revision||'')?revision:null,capabilities:{htmlUpload:true,categories:categoryKeys}};
}
