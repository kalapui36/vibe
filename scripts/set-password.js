import { stdin, stdout } from 'node:process';
import { setPassword } from '../store.js';

if (!stdin.isTTY) {
  console.error('터미널에서 npm run admin:password 를 실행해 주세요.');
  process.exit(1);
}
stdout.write('새 관리자 비밀번호 (4자 이상): ');
stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding('utf8');
let password = '';
stdin.on('data', chunk => {
  for (const char of chunk) {
    if (char === '\u0003') { stdout.write('\n'); process.exit(130); }
    if (char === '\r' || char === '\n') {
      stdin.setRawMode(false);
      stdout.write('\n');
      if (password.length < 4) { console.error('4자 이상 입력해 주세요.'); process.exit(1); }
      setPassword(password);
      console.log('비밀번호를 저장했습니다. 기존 로그인은 해제됩니다.');
      process.exit(0);
    }
    if (char === '\u007f') password = password.slice(0, -1);
    else if (char >= ' ') password += char;
  }
});
