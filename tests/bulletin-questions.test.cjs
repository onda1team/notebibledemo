const test=require('node:test'),assert=require('node:assert/strict'),B=require('../client/bulletin-questions.js');
test('a numbered Korean question section ignores numbered notices and joins wrapped lines',()=>{
  const source='주일예배\n1. 오전 9시\n말씀 나눔\n1. 오늘 말씀에서\n무엇을 발견했나요?\n② 실천할 일을 적어 보세요.\n교회 소식\n1. 다음 주 일정';
  assert.deepEqual(B.extract(source),['1. 오늘 말씀에서 무엇을 발견했나요?','② 실천할 일을 적어 보세요.']);
});
test('unrecognized notices remain in the raw preview rather than being inserted as questions',()=>{
  assert.deepEqual(B.extract('1. 교회 주차 안내\n2. 9시 예배 시작'),[]);
  assert.deepEqual(B.extract('무엇을 감사했나요?\n예배는 9시입니다.'),['무엇을 감사했나요?']);
});
test('review preserves plain editable text and enforces safe bounds',()=>{
  assert.deepEqual(B.parseReview('1. <말씀>\n\n2. 다음 질문?'),['1. <말씀>','2. 다음 질문?']);
  assert.equal(B.parseReview('가'.repeat(800))[0].length,700);
  assert.equal(B.parseReview(Array(45).fill('질문').join('\n')).length,30);
  const entry={id:'a',question:'본문',answer:'답',reference:'마태복음 5장 7절'};
  assert.deepEqual(B.normalize([entry,entry,{id:'skip'}]),[entry]);
});
test('two bulletin sections can each start at 1 and keep all wrapped questions in order',()=>{
 const sample='▶ 본문이해\n이 해설은 제외한다.\n | * 본 문 나 눔\n1. 첫 질문은 무엇인가요? 이어지는 문장도\n 포함하나요?\n2. 두 번째 질문인가요? (엡 2:14)\n3 세 번째 질문을 적습니다.\n> 결단하기\n1. 첫 결단 질문인가요? 두 번째 줄도\n합칩니다.\n2. 두 번째 결단입니다.\n3. 세 번째 결단인가요?\n▶ 교회 소식\n1. 공지는 제외한다.';
 const result=B.extract(sample);
 assert.equal(result.length,6);
 assert.deepEqual(result.map(x=>x.split(' ').slice(0,2).join(' ')),['본문나눔 1.','본문나눔 2.','본문나눔 3.','결단하기 1.','결단하기 2.','결단하기 3.']);
 assert.match(result[0],/이어지는 문장도 포함하나요/);
 assert.match(result[1],/\(엡 2:14\)/);
 assert.match(result[3],/두 번째 줄도 합칩니다/);
});
test('repeat scan fills earlier and later missing questions without replacing existing answer or ID',()=>{
 const saved={id:'kept',question:'1. 나는 평소 다른 사람의 말을 잘 들어주는 편인가요? 내 생각만 앞세운 적은 없나요?',answer:'기존 답',reference:'마태복음 5장'};
 const unrelated={id:'other',question:'오늘 감사한 일은?',answer:'그대로',reference:'마태복음 5장'};
 const scan=['본문나눔 1. 이번 본문은 무엇인가요?','결단하기 1. 나는 평소 다른 사람의 말을 잘 들어주는 편인가요? 내 생각만 앞세운 적은 없나요?','결단하기 2. 다음으로 할 일은?'];
 const make=(question,i)=>({id:'new'+i,question,answer:'',reference:'마태복음 5장 9절'});
 const a=B.mergeQuestions([unrelated,saved],scan,make);
 assert.equal(a.added,2);assert.equal(a.first,1);
 assert.deepEqual(a.entries.map(r=>r.id),['other','new0','kept','new2']);
 assert.strictEqual(a.entries[2],saved);assert.equal(a.entries[2].answer,'기존 답');
 const b=B.mergeQuestions(a.entries,scan,make);
 assert.equal(b.added,0);assert.deepEqual(b.entries,a.entries);
});
test('full bulletin text preserves all sections and paragraphs, separate from answer fields',()=>{
 const body='셀 가족 말씀 나눔\r\n\r\n성경: 마태복음 5장 9절\r\n찬송: 412장   \r\n\r\n들어가기\r\n두 사람씩 짝을 지어 봅시다.\r\n\r\n본문이해\r\n나라와 이웃의 관계\r\n\r\n본문나눔\r\n1. 무엇을 배웠나요?\r\n결단하기\r\n1. 어떻게 실천할까요?';
 const cleaned=B.cleanBody(body);
 assert.match(cleaned,/412장\n\n들어가기/);
 assert.match(cleaned,/본문이해\n나라와 이웃의 관계\n\n본문나눔/);
 assert.ok(cleaned.endsWith('1. 어떻게 실천할까요?'));
 assert.equal(B.extract(cleaned).length,2);
 const entry={id:'body',reference:'마태복음 5장 9절',text:cleaned};
 assert.deepEqual(B.normalizeBody([entry,entry]),[entry]);
 assert.equal(B.bodyIndex([entry],body),0);
 assert.equal(B.bodyIndex([entry],''),-1);
});
test('visual grouping distinguishes ordinary sections and retains unfamiliar marked content in order',()=>{
 const raw='셀 주보\n본문: 마태복음 5장 9절\n\n* 들어가기\n먼저 인사합니다.\n\n본문이해\n본문을 읽습니다.\n본문나눔\n1. 어떤 점이 좋았나요?\n결단하기\n1. 무엇을 할까요?\n【이번 달 선교 소식】\n첫 문단\n\n그 다음 문단\n함께 기도\n서로를 위해 기도합니다.';
 const parts=B.sections(raw);
 assert.deepEqual(parts.map(r=>r.kind),['overview','opening','scripture','questions','action','other','prayer']);
 assert.deepEqual(parts.map(r=>r.title),['주보 기본 정보','들어가기','본문이해','본문나눔','결단하기','이번 달 선교 소식','함께 기도']);
 const text=parts.map(r=>[r.headingLine,r.text].filter(Boolean).join('\n')).join('\n');
 assert.equal(text.replace(/\s+/g,''),raw.replace(/\s+/g,''));
 assert.equal(B.questionKind('결단하기 1. 무엇을 할까요?'),'action');
});
test('plain unstructured layouts keep every paragraph rather than dropping unfamiliar text',()=>{
 const raw='격려의 한마디\n좋은 하루입니다.\n\n오늘 준비한 행사입니다.\n\n새로운 안내.';
 const parts=B.sections(raw);
 assert.equal(parts.length,3);
 assert.equal(parts.map(r=>r.text).join('\n\n'),raw);
});
test('a section raw question card is collapsible only when all questions have answer cards',()=>{
 const part=B.sections('본문나눔\n1. 오늘 무엇을 배웠나요?\n2. 이번 주에 무엇을 할까요?')[0];
 const cards=[{question:'본문나눔 1. 오늘 무엇을 배웠나요?',answer:'답안을 유지합니다.'},{question:'2. 이번 주에 무엇을 할까요?',answer:''}];
 assert.equal(B.sectionHasAnswerCards(part,cards),true);
 assert.equal(B.sectionHasAnswerCards(part,cards.slice(0,1)),false);
 assert.equal(B.sectionHasAnswerCards(part,[cards[0],cards[0]]),false);
 assert.equal(B.sectionHasAnswerCards(B.sections('본문이해\n그대로 보여요.')[0],cards),false);
 assert.equal(cards[0].answer,'답안을 유지합니다.');
});
test('unlabeled continuation retains every paragraph without inventing a display heading',()=>{
 const raw='첫 문단이에요.\n\n두 번째 문단이에요.\n\n세 번째 문단이에요.';
 const parts=B.sections(raw);
 assert.deepEqual(parts.map(r=>r.title),['주보 내용','','']);
 assert.equal(parts.map(r=>r.text).join('\n\n'),raw);
 const genuine=B.sections('첫 문단이에요.\n▶ 이어지는 내용\n실제 주보가 붙인 제목은 유지해요.');
 assert.equal(genuine[1].title,'이어지는 내용');
 assert.equal(genuine[1].headingLine,'▶ 이어지는 내용');
});
