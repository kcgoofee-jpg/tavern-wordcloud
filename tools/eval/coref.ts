/**
 * Person-coreference harness (TODO C.6).
 *
 *   npm run eval:coref
 *
 * `detectCoref` proposes that several surface forms name one person. This
 * harness answers the two numbers that decide whether the proposal may be
 * applied automatically:
 *
 *   alias recall  = gold aliases proposed / gold aliases
 *   mis-merge rate = proposals that are not gold / proposals
 *
 * The bar (TODO C.6) is recall ≥ 60% with mis-merge ≤ 5%.
 *
 * The corpus is synthetic on purpose: real chat logs never enter the repository
 * (AGENTS.md hard rule 1), and a labelled negative — two same-surname people who
 * really are two people — cannot be harvested from a log without copying it out.
 * The cases are written to reproduce the shapes actually observed on the local
 * export: a given name that is also a dictionary word, a given name that never
 * occurs outside the full name, a title (`X老师`) shared by two different people,
 * and a title held by exactly one.
 *
 * `--ablate` reruns the whole set once per criterion, each time with that
 * criterion alone switched off, and prints the single-variable table.
 */
import { detectCoref, detectEntities, type CorefOptions } from '../../src/core/entities';
import { detectEnglishNames } from '../../src/core/english';

interface Case {
  id: string;
  why: string;
  msgs: string[];
  /** full name -> aliases that must be proposed. Any other proposal is a mis-merge. */
  gold: Record<string, string[]>;
}

/**
 * Five sentences that put `name` in five distinct syntactic positions, which is
 * what `detectEntities` needs before it will call a string a person at all.
 */
function intro(name: string, extra: string[] = []): string[] {
  return [
    `${name}说道："这个方案我看过了。"`,
    `${name}点了点头，没有再说话。`,
    `${name}的声音压得很低。`,
    `林岚和${name}说了几句就走了。`,
    `${name}，你先坐下。`,
    ...extra,
  ];
}

/* ---------- Positives: the alias really is the same person ---------- */

const POSITIVE: Case[] = [
  {
    id: 'P1 小姓',
    why: '小赵 与全名同现',
    msgs: [...intro('赵一文'),
      '小赵今天来得早，赵一文让他把门带上。',
      '小赵把文件放在桌上。',
      '小赵笑了笑，没有接话。',
      '楼下叫的是小赵。'],
    gold: { 赵一文: ['小赵', '一文'] },
  },
  {
    id: 'P2 姓+称谓',
    why: '陆总 与全名同现，公司里只有一位「总」',
    msgs: [...intro('陆时衍'),
      '陆总把合同推过来，陆时衍的字签得很快。',
      '陆总先开口，会议就算开始了。',
      '陆总看了看表，站起身。',
      '楼下等的是陆总。'],
    gold: { 陆时衍: ['陆总', '时衍'] },
  },
  {
    id: 'P3 去姓（大部分在全名里）',
    why: '砚秋 几乎只作为 沈砚秋 的一部分出现，独立用法很少',
    msgs: [...intro('沈砚秋'),
      '沈砚秋走进来，屋里很安静。',
      '沈砚秋接过杯子，沈砚秋没有喝。',
      '砚秋，你过来一下。沈砚秋抬起头。',
      '他叫了一声砚秋，沈砚秋应了。'],
    gold: { 沈砚秋: ['砚秋'] },
  },
  {
    id: 'P4 去姓且是词典词',
    why: '高飞 是词典词，但实体层独立给了它人名证据',
    msgs: [...intro('沈高飞'),
      ...intro('高飞'),
      '高飞把箱子搬进来，沈高飞在门口站着。',
      '高飞回头看了一眼，沈高飞跟了上去。',
      '高飞没说话，沈高飞把灯关了。'],
    gold: { 沈高飞: ['高飞'] },
  },
  {
    id: 'P5 去姓且从不单独出现',
    why: '晓龙 只出现在 郑晓龙 里；合并不会改动任何一行词表',
    msgs: [...intro('郑晓龙'),
      '郑晓龙把镜头调过来。',
      '郑晓龙又看了一遍监视器。',
      '郑晓龙让大家先休息。'],
    gold: { 郑晓龙: ['晓龙'] },
  },
  {
    id: 'P6 老姓',
    why: '老陈 与全名同现',
    msgs: [...intro('陈君山'),
      '老陈把伞收起来，陈君山请他坐。',
      '老陈笑着摆手。',
      '老陈说不急。',
      '门口站着的是老陈。'],
    gold: { 陈君山: ['老陈', '君山'] },
  },
  {
    id: 'P7 姓+职业（唯一持有者）',
    why: '全篇只有一位医生',
    msgs: [...intro('林向文'),
      '林医生走进病房，林向文看了看单子。',
      '林医生把片子举起来对着灯。',
      '林医生说再观察两天。',
      '护士去叫林医生了。'],
    gold: { 林向文: ['林医生', '向文'] },
  },
  {
    id: 'P8 姓+小姐',
    why: '苏小姐 与全名同现',
    msgs: [...intro('苏念安'),
      '苏小姐把包放下，苏念安脱了外套。',
      '苏小姐问了一句，然后摇头。',
      '苏小姐先走了。',
      '前台说苏小姐还没到。'],
    gold: { 苏念安: ['苏小姐', '念安'] },
  },
  {
    id: 'P9 去姓 + 姓+称谓 同时成立',
    why: '一份记录里两种短称都用',
    msgs: [...intro('周敬亭'),
      '周敬亭把卷宗合上。',
      '敬亭，你怎么看。周敬亭没有回答。',
      '他喊了声敬亭，周敬亭才回神。',
      '周律师推门进来，周敬亭把卷宗递过去。',
      '周律师把材料交上去。',
      '周律师说没问题。',
      '走廊里等的是周律师。'],
    gold: { 周敬亭: ['敬亭', '周律师'] },
  },
  {
    id: 'P10 叠字小名',
    why: '宁宁 是 苏安宁 的叠字小名',
    msgs: [...intro('苏安宁'),
      '宁宁蹲在门口，苏安宁把她抱起来。',
      '宁宁不肯走。',
      '宁宁终于笑了。',
      '院子里只有宁宁一个人。'],
    gold: { 苏安宁: ['宁宁', '安宁'] },
  },
  {
    id: 'P11 复姓',
    why: '复姓丢两个字',
    msgs: [...intro('欧阳明轩'),
      '欧阳明轩把琴放下。',
      '明轩，过来。欧阳明轩走了过去。',
      '她叫了声明轩，欧阳明轩应了一句。'],
    gold: { 欧阳明轩: ['明轩'] },
  },
  {
    id: 'P12 姓+队长',
    why: '全篇只有一位队长',
    msgs: [...intro('韩子野'),
      '韩队长把地图铺开，韩子野指了指路口。',
      '韩队长下了命令，队伍立刻散开。',
      '韩队长回头看了一眼。',
      '通讯里叫的是韩队长。'],
    gold: { 韩子野: ['韩队长', '子野'] },
  },
  {
    id: 'P13 英文名 / 姓',
    why: '英文全名的两半都是同一人',
    msgs: [
      'Eleanor Vance walked into the room and Eleanor sat down.',
      'Eleanor Vance said nothing. Eleanor looked at the window.',
      'The letter was for Eleanor Vance. Eleanor opened it.',
      'Eleanor Vance left early; Eleanor did not come back.',
      "Eleanor's coat was still there when Eleanor Vance returned.",
      'Eleanor came back at noon.',
      "Eleanor's hands were shaking.",
      'Nobody had told Eleanor anything.',
    ],
    gold: { 'Eleanor Vance': ['Eleanor', "Eleanor's"] },
  },
  {
    id: 'P14 英文名 + 敬称',
    why: 'Mr. Cole 与全名同现',
    msgs: [
      'Dominic Cole opened the file and Mr. Cole started reading.',
      'Mr. Cole asked a question; Dominic Cole waited.',
      'Dominic Cole nodded. Mr. Cole put the file down.',
      'Later Dominic Cole came back and Mr. Cole apologised.',
      'Mr. Cole was late again.',
      'The porter asked for Mr. Cole.',
      'Mr. Cole never answered.',
    ],
    gold: { 'Dominic Cole': ['Mr. Cole', 'Cole'] },
  },
  {
    id: 'P15 姓+叔',
    why: '周叔 与全名同现',
    msgs: [...intro('周汝成'),
      '周叔把车停在门口，周汝成下了车。',
      '周叔递过来一包烟。',
      '周叔笑了笑就走了。',
      '院子里只剩下周叔。'],
    gold: { 周汝成: ['周叔', '汝成'] },
  },
  {
    id: 'P16 姓+总（去姓也成立）',
    why: '两种短称都有独立证据',
    msgs: [...intro('魏长风'),
      '魏总把方案退回来，魏长风又改了一版。',
      '魏总不满意，把稿子摔在桌上。',
      '魏总终于点头了。',
      '前台说魏总在开会。',
      '长风，你留一下。魏长风停住脚步。',
      '她叫了声长风，魏长风回过头。'],
    gold: { 魏长风: ['魏总', '长风'] },
  },
  {
    id: 'P17 姓+同学（同学是亲属/称呼表里的词）',
    why: '同学 在封闭词表里，只有去姓形式该并',
    msgs: [...intro('谢慧兰'),
      '谢同学把作业交上来，谢慧兰站在讲台边。',
      '谢同学答得很快。',
      '谢同学坐下了。',
      '点名的时候没有谢同学。'],
    gold: { 谢慧兰: ['谢同学', '慧兰'] },
  },
];

/* ---------- Negatives: same shape, different person ---------- */

const NEGATIVE: Case[] = [
  {
    id: 'N1 同姓两人',
    why: '小赵 在两个姓赵的人之间有歧义',
    msgs: [...intro('赵一文'), ...intro('赵明远'),
      '小赵今天来得早。', '小赵把文件放在桌上。', '小赵笑了笑，没有接话。'],
    gold: { 赵一文: ['一文'], 赵明远: ['明远'] },
  },
  {
    id: 'N2 老师是两个人',
    why: '周老师 与 沈老师 同在一篇里；周老师 既和 周敬亭 同现也单独出现，只有称谓一致性能挡',
    msgs: [...intro('周敬亭'), ...intro('沈砚秋'),
      '周老师在楼下等，沈老师还没来。',
      '周老师把名单念完，沈老师补了两句。',
      '周老师走了以后沈老师才坐下。',
      '周老师叫住周敬亭，问他卷宗的事。',
      '周敬亭没理会周老师。',
      '周老师又去了办公室。'],
    gold: { 周敬亭: ['敬亭'], 沈砚秋: ['砚秋'] },
  },
  {
    id: 'N3 副导演是两个人',
    why: '郑副导演 与 王副导演 同在一篇里',
    msgs: [...intro('郑晓龙'),
      '郑副导演在监视器后面，王副导演去了外景。',
      '郑副导演喊了停，王副导演没听见。',
      '郑副导演和王副导演对了一遍通告。'],
    gold: { 郑晓龙: ['晓龙'] },
  },
  {
    id: 'N4 师生同姓',
    why: '沈老师 是母亲，沈砚秋 是儿子；两人同场出现',
    msgs: [...intro('沈砚秋'),
      '沈老师把饭端上桌，沈砚秋没有动筷子。',
      '沈老师叹了口气，沈砚秋起身回房。',
      '沈老师站在门口，沈砚秋没有回头。',
      '沈老师在客厅坐着，沈砚秋在阳台抽烟。'],
    gold: { 沈砚秋: ['砚秋'] },
  },
  {
    id: 'N5 去姓是常用词且没有人名证据',
    why: '安静 是形容词，全篇没有把它当人用过',
    msgs: [...intro('王安静'),
      '屋里很安静，只有钟摆的声音。',
      '楼道安静得吓人。',
      '他安静地坐了一会儿。',
      '外面忽然安静下来。'],
    gold: {},
  },
  {
    id: 'N6 两位总',
    why: '陆总 与 刘总 同在一篇：总是共享的头衔',
    msgs: [...intro('陆时衍'),
      '陆总先到，刘总还在路上。',
      '陆总和刘总谈了半小时。',
      '刘总走后陆总才开口。'],
    gold: { 陆时衍: ['时衍'] },
  },
  {
    id: 'N7 同姓的两个全名共用去姓形式',
    why: '砚秋 由 沈砚秋 与 顾砚秋 共同提出',
    msgs: [...intro('沈砚秋'), ...intro('顾砚秋'),
      '砚秋，你过来。', '他叫了声砚秋。', '砚秋没有回头。'],
    gold: {},
  },
  {
    id: 'N8 姓+医生是另一个人',
    why: '林医生 与 林向文 从不同现，且另有一位周医生',
    msgs: [...intro('林向文'),
      '林医生在三楼值班，周医生在急诊。',
      '林医生换了班，周医生还在。',
      '林医生和周医生交接完就走了。'],
    gold: { 林向文: ['向文'] },
  },
  {
    id: 'N9 亲属称谓不是别名',
    why: '老公 / 小三 由同样的构词法生成，但它们是普通词',
    msgs: [...intro('公孙止'), ...intro('三月生'),
      '老公今天回来得晚。', '老公把外套挂好。', '老公说不用等他。',
      '小三这个词她说不出口。', '外面都在传小三。', '小三的事没人提。'],
    gold: {},
  },
  {
    id: 'N10 姓+经理是同姓的另一个人',
    why: '两位姓郑的：郑晓龙 是导演，郑经理 是酒店的',
    msgs: [...intro('郑晓龙'), ...intro('郑海鹏'),
      '郑经理在前台等着。', '郑经理把房卡递过来。', '郑经理说房间已经准备好了。'],
    gold: { 郑晓龙: ['晓龙'], 郑海鹏: ['海鹏'] },
  },
];

const CASES = [...POSITIVE, ...NEGATIVE];

/* ---------- Scoring ---------- */

interface Score {
  recalled: number; goldTotal: number; proposals: number; wrong: string[];
  /** Same numbers with the drop-surname forms excluded: those are the easy half. */
  hardRecalled: number; hardGold: number;
  /** Gold aliases that were not proposed. */
  missed: string[];
}

/** 砚秋 of 沈砚秋 — a suffix of the full name, and the cheapest kind of alias to get right. */
const isTail = (full: string, alias: string) => /^[一-鿿]+$/.test(full) && full.endsWith(alias);

function score(opts: CorefOptions): Score {
  let recalled = 0, goldTotal = 0, proposals = 0, hardRecalled = 0, hardGold = 0;
  const wrong: string[] = [];
  const missed: string[] = [];
  for (const c of CASES) {
    const index = detectEntities(c.msgs);
    const en = detectEnglishNames(c.msgs);
    const groups = detectCoref(c.msgs, [...index.personNames, ...en], index, opts);
    const got = new Map<string, Set<string>>();
    for (const g of groups) got.set(g.full, new Set(g.aliases));
    for (const [full, aliases] of Object.entries(c.gold)) {
      goldTotal += aliases.length;
      for (const a of aliases) {
        const hit = got.get(full)?.has(a) ?? false;
        if (hit) recalled++; else missed.push(`${c.id}: ${a}→${full}`);
        if (!isTail(full, a)) { hardGold++; if (hit) hardRecalled++; }
      }
    }
    for (const g of groups) {
      const allowed = new Set(c.gold[g.full] ?? []);
      for (const a of g.aliases) {
        proposals++;
        if (!allowed.has(a)) wrong.push(`${c.id}: ${a}→${g.full}`);
      }
    }
  }
  return { recalled, goldTotal, proposals, wrong, hardRecalled, hardGold, missed };
}

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : '—') + '%';

function line(name: string, s: Score): string {
  return `${name.padEnd(24)} 召回 ${String(s.recalled).padStart(2)}/${s.goldTotal} = ${pct(s.recalled, s.goldTotal).padStart(6)}`
    + `   误并 ${String(s.wrong.length).padStart(2)}/${s.proposals} = ${pct(s.wrong.length, s.proposals).padStart(6)}`
    + `   非去姓召回 ${String(s.hardRecalled).padStart(2)}/${s.hardGold}`;
}

/** Shipping defaults; every ablation below flips exactly one field of this. */
const SHIPPED: CorefOptions = {};

const RECALL_BAR = 0.6;
const MERGE_BAR = 0.05;

console.log(`用例 ${CASES.length} 组（正例 ${POSITIVE.length}、负例 ${NEGATIVE.length}）`);
const base = score(SHIPPED);
console.log('\n' + line('当前默认', base));
if (base.wrong.length) console.log('  误并：' + base.wrong.join('  '));
if (base.missed.length) console.log('  漏召回：' + base.missed.join('  '));

if (process.argv.includes('--ablate')) {
  console.log('\n单变量消融（每行只关掉一条判据）：');
  const flips: [string, CorefOptions][] = [
    ['+ 互补分布（A17 旧默认）', { allowComplementary: true }],
    ['− 替换证据', { requireSubstitution: false }],
    ['− 去姓证据', { tailEvidence: false }],
    ['− 称谓一致性', { titleShared: false }],
    ['A17 四条判据（旧版）', { allowComplementary: true, requireSubstitution: false, tailEvidence: false, titleShared: false }],
    ['A17 − 互补分布（复现）', { allowComplementary: false, requireSubstitution: false, tailEvidence: false, titleShared: false }],
  ];
  for (const [name, o] of flips) {
    const s = score({ ...SHIPPED, ...o });
    console.log('  ' + line(name, s));
    if (s.wrong.length) console.log('      误并：' + s.wrong.join('  '));
  }
}

const recall = base.recalled / Math.max(1, base.goldTotal);
const merge = base.wrong.length / Math.max(1, base.proposals);
const ok = recall >= RECALL_BAR && merge <= MERGE_BAR;
console.log(`\n门槛：召回 ≥ ${RECALL_BAR * 100}% 且误并 ≤ ${MERGE_BAR * 100}%`);
if (!ok) {
  console.log('❌ 未达标：同指只提示，不自动合并');
  process.exit(1);
}
console.log('✅ 达标');
