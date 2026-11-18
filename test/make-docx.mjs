// Makes test/sample.docx: an Arabic book with heading styles and real Word footnotes.
import { writeFileSync } from 'node:fs';
import { Document, FootnoteReferenceRun, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

const p = (text, notes = []) =>
  new Paragraph({ bidirectional: true, children: [new TextRun({ text, rightToLeft: true }), ...notes.map((n) => new FootnoteReferenceRun(n))] });
const h = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, bidirectional: true, children: [new TextRun({ text, rightToLeft: true })] });

const body = [h('كتاب الطهارة')];
for (let i = 1; i <= 12; i++) {
  body.push(p(`${i} - عن أبي هريرة رضي الله عنه أن رسول الله صلى الله عليه وسلم قال: لا يقبل الله صلاة أحدكم إذا أحدث حتى يتوضأ. وهذا الحديث أصل في وجوب الطهارة للصلاة.`, i % 4 === 1 ? [i] : []));
}
body.push(h('باب دخول الخلاء'));
for (let i = 13; i <= 20; i++) body.push(p(`${i} - عن أنس بن مالك رضي الله عنه قال: كان النبي صلى الله عليه وسلم إذا دخل الخلاء قال: اللهم إني أعوذ بك من الخبث والخبائث.`, i === 13 ? [13] : []));

const footnotes = {};
for (const n of [1, 5, 9, 13]) footnotes[n] = { children: [new Paragraph({ bidirectional: true, children: [new TextRun({ text: `رواه البخاري ومسلم، رقم ${n}.`, rightToLeft: true })] })] };

const doc = new Document({ footnotes, sections: [{ children: body }] });
writeFileSync(new URL('./sample.docx', import.meta.url), await Packer.toBuffer(doc));
console.log('ok');
