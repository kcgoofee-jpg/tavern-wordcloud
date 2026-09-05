/**
 * Word-kind precision harness (place / time / brand / wear / title).
 *
 *   npx vite-node tools/eval/kinds.ts        # or: npm run eval:kinds
 *
 * `eval:persons` measures the person layer. This one measures the other two
 * morphology-driven kinds: `classify` labels a word `place` from a suffix and
 * `time` from a large alternation, and both used to over-fire — body parts and
 * direction words became places, adverbs and conjunctions became time.
 *
 * Negatives are the strings misfiled in an earlier round; the words below are rewritten examples
 * (2026-09-04). Positives are hand-written ground truth. Exits non-zero when any
 * negative is still accepted, or when a gated positive is lost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyKinds, detectEntities, ENTITY_LABEL, EXPERIMENTAL_KINDS, type EntityKind } from '../../src/core/entities';
import { corpusSentences } from './run';

/* ---------- Negatives: observed on the real export ---------- */

/** Body parts, direction words and verb-object phrases caught by the place suffixes. */
const PLACE_NEG = [
  '胸口', '乳房', '面部', '大口', '裆部', '胸部', '腰部', '臀部', '阴部', '根部',
  '虎口', '背部', '中部', '内部', '外部', '底部', '尾部',
  '吐司', '查房', '接口', '磁场', '一路', '当场', '现场',
];

/** Adverbs, conjunctions and non-temporal nouns caught by the time alternation. */
const TIME_NEG = [
  '雨水', '最终', '更深', '往前', '一秒', '一瞬间', '临时', '平时',
  '这时', '什么时候', '偶尔', '先前', '不久',
];

/* ---------- Positives ---------- */

interface Positive { word: string; gate: boolean }

/**
 * Gated positives are the ones the suffix / alternation rules can reach at all.
 * `北京` / `墨西哥` carry no place suffix and no rule is supposed to produce
 * them without a gazetteer (hard rule 3: no dictionary files), so they are
 * reported for recall but not gated.
 */
const UNGATED = new Set(['墨西哥', '北京']);

const PLACE_POS: Positive[] = [
  '片场', '餐厅', '厨房', '浴室', '卧室', '客厅', '二楼', '一楼', '门口', '出口',
  '入口', '柏油路', '高速公路', '马路', '墨西哥', '北京', '朝阳区', '居民楼',
  '排练厅', '中央戏剧学院',
].map((word) => ({ word, gate: !UNGATED.has(word) }));

const TIME_POS: Positive[] = [
  '十分钟', '五分钟', '周日', '正午', '上午', '早上', '昨夜', '清晨', '下午',
  '三天', '八分', '六号', '二号', 'sunday', 'afternoon', 'morning', 'today',
].map((word) => ({ word, gate: true }));

/* ---------- Corpora ---------- */

/**
 * Real logs are read only to check the positives actually occur in natural
 * writing; nothing is copied out and no text is printed.
 */
function fixtureTexts(): string[] {
  const dir = fileURLToPath(new URL('../../fixtures/', import.meta.url));
  const out: string[] = [];
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { mes?: unknown };
        if (typeof o.mes === 'string') out.push(o.mes);
      } catch { /* not a message line */ }
    }
  }
  return out;
}

/* ---------- The three kinds added in F10 (docs/27 §7) ---------- */

/**
 * Garments. Negatives are words that end in one of the design note's seed
 * characters but are not clothing (声带 / 毛巾 / 说服), plus ordinary objects
 * from the local TOP list.
 */
const WEAR_POS: Positive[] = [
  '衬衫', '外套', '裙子', '裤子', '丝袜', '领带', '内衣', '吊带', '大衣', '毛衣',
  '制服', '睡衣', '帽子', '鞋子', '高跟鞋', '长裙', '短裤', '袜子', '皮靴', '围巾',
  '婚纱', '手套',
].map((word) => ({ word, gate: true }));
const WEAR_NEG = [
  '声带', '磁带', '胶带', '地带', '一带', '韧带', '绷带', '纽带', '毛巾', '餐巾',
  '说服', '佩服', '舒服', '克服', '征服', '屈服',
  '合同', '电话', '沙发', '茶几', '抽屉',
];

/** Terms of address and job titles. `赵总` / `王老师` exercise the 姓 + 称谓 construction. */
const TITLE_POS: Positive[] = [
  '陛下', '殿下', '大人', '老板', '先生', '小姐', '女士', '夫人', '少爷', '公子',
  '总监', '经理', '导演', '制片', '主任', '老师', '医生', '队长', '前辈', '师父',
  '赵总', '王老师', '李经理',
].map((word) => ({ word, gate: true }));
const TITLE_NEG = [
  '合同', '电话', '手机', '名字', '电视', '抽屉', '项目', '剧组', '书包', '协议',
  '信封', '剧本', '角色', '消息', '投资', '平台', '屏幕', '筷子', '桌子', '沙发',
];

/**
 * Brands. Only two shapes are claimed: a token that itself ends in a corporate
 * suffix, and a corpus-attested Latin or transliterated word. The second shape
 * needs sentences to work on, so a handful of hand-written ones are appended to
 * the corpus (no real chat content is used or printed).
 */
const BRAND_POS: Positive[] = [
  '山文化工作室', '天宇集团', '星辰工作室', '华美公司', '蓝天集团', '光影工作室',
  '永久牌', '飞跃牌', '海鸥牌', '回力牌', '大白兔牌', '红星牌', '微软官方', '索尼公司',
  'nike', 'adidas', 'chanel', '迪奥', '索菲亚',
].map((word) => ({ word, gate: true }));
const BRAND_NEG = [
  '公司', '电话', '合同', '项目', '剧组', '平台', '投资', '影视', '制片', '卫视',
  '名片', '制作', '出品', '行业', '渠道', '财务', '部门', '银行', '会议', '账本',
];

/** Hand-written sentences, only so the corpus-context brand rules have something to fire on. */
const BRAND_SENTENCES = [
  'NIKE牌的鞋摆在门口，ADIDAS公司的人还没来。',
  'Chanel官方发了新款，ADIDAS公司说要跟。',
  'NIKE牌的广告挂在楼下，Chanel官方也来了。',
  '她穿了迪奥的裙子。', '我买了迪奥的新款。', '迪奥牌的口红也在。',
  '她穿索菲亚的外套。', '我买索菲亚的鞋。', '索菲亚牌的包在柜台上。',
];

/* ---------- Run ---------- */

const logs = corpusSentences();
const fixtures = fixtureTexts();
if (!logs.length) console.log('（本机酒馆语料没找到，只用 fixtures）');
const corpus = [...logs, ...fixtures];
const index = detectEntities(corpus);
/** Separate index so the synthetic brand sentences cannot influence the place / time numbers. */
const brandIndex = detectEntities([...corpus, ...BRAND_SENTENCES]);

const seenIn = (w: string) => corpus.some((t) => t.includes(w));

/** A word can carry several kinds now; a hit means the kind is among them. */
const hasKind = (w: string, kind: EntityKind, idx = index) =>
  classifyKinds(w, idx).some((k) => k.kind === kind);

interface Report { kind: EntityKind; precision: number; bad: number }

function measure(kind: EntityKind, pos: Positive[], neg: string[], idx = index): Report {
  const tp = pos.filter((p) => hasKind(p.word, kind, idx));
  const fp = neg.filter((n) => hasKind(n, kind, idx));
  const fn = pos.filter((p) => !hasKind(p.word, kind, idx));
  const gated = pos.filter((p) => p.gate);
  const lost = gated.filter((p) => !hasKind(p.word, kind, idx));
  const precision = tp.length / Math.max(1, tp.length + fp.length);
  const label = ENTITY_LABEL[kind];
  console.log(`\n【${label}】正例 ${pos.length}（门禁 ${gated.length}）  负例 ${neg.length}`);
  console.log(`  准确率 precision = ${tp.length}/${tp.length + fp.length} = ${(precision * 100).toFixed(1)}%`);
  console.log(`  召回率 recall    = ${tp.length}/${pos.length} = ${(tp.length / pos.length * 100).toFixed(1)}%`);
  console.log(`  门禁召回        = ${gated.length - lost.length}/${gated.length}`);
  if (fp.length) console.log(`  ❌ 仍被当成${label}的负例：` + fp.join(' '));
  if (fn.length) console.log(`  没被认成${label}的正例：` + fn.map((p) => p.word + (p.gate ? '(门禁)' : '')).join(' '));
  return { kind, precision, bad: fp.length + lost.length };
}

console.log(`语料：本机 ${logs.length} 句 + fixtures ${fixtures.length} 条`);
const missing = [...PLACE_POS, ...TIME_POS].filter((p) => !/^[a-z]+$/.test(p.word) && !seenIn(p.word));
if (missing.length) console.log(`（正例里语料未出现的：${missing.map((p) => p.word).join(' ')}）`);

/** The two original kinds are gated word by word: every negative rejected, every gated positive kept. */
let bad = measure('place', PLACE_POS, PLACE_NEG).bad + measure('time', TIME_POS, TIME_NEG).bad;

/**
 * The three new kinds are gated on precision instead: 80% is the line from
 * docs/27 §7, and anything under it must be declared experimental in
 * `EXPERIMENTAL_KINDS` so the UI warns about it. Recall is reported, not gated —
 * these rules are small seed tables on purpose.
 */
const NEW_KINDS: Report[] = [
  measure('wear', WEAR_POS, WEAR_NEG),
  measure('title', TITLE_POS, TITLE_NEG),
  measure('brand', BRAND_POS, BRAND_NEG, brandIndex),
];
/* ---------- Batch 2: the 16 kinds added for the 60-kind design (docs/33) ----------
   Every kind gets >= 12 positives and >= 12 negatives. Negatives are drawn from
   the head of the local TOP list plus the confusables each rule's seed characters
   invite (口袋 vs 脑袋, 红色 vs 角色, 出租车 vs 停车). Only the words are written
   down here — no chat text is copied or printed. */

const pos = (ws: string[]): Positive[] => ws.map((word) => ({ word, gate: true }));
/**
 * Positives no construction rule can reach on this machine, so they are measured
 * but not gated. All of them are ordinary nouns that the *person* layer claims on
 * the local logs (合同 / 协议 / 通告单 / 台词 / 开幕式 all reach `personNames`),
 * and docs/33 §4 makes `person` exclusive of every construction kind. Fixing that
 * belongs to the person layer, not here; gating on it would make this harness red
 * for a bug it does not own.
 */
const posSoft = (ws: string[]): Positive[] => ws.map((word) => ({ word, gate: false }));
/** Ordinary high-frequency nouns from the local TOP list; none of them is any of the new kinds. */
const TOP_NOISE = ['合同', '电话', '剧组', '项目', '平台', '消息', '屏幕', '名字', '电视', '手机', '桌子', '沙发'];

interface KindCase { kind: EntityKind; pos: Positive[]; neg: string[] }

const BATCH2: KindCase[] = [
  { kind: 'kinship',
    pos: pos(['妈妈', '母亲', '爸爸', '父亲', '儿子', '女儿', '哥哥', '姐姐', '弟弟', '妹妹', '爷爷', '奶奶', '叔叔', '阿姨', '老公', '妻子']),
    neg: ['老师', '医生', '警察', '老板', '经理', '同学', '孩子', '男人', '女人', '学生', '客人', '合同'] },
  { kind: 'occupation',
    pos: pos(['医生', '律师', '教师', '警察', '护士', '司机', '厨师', '演员', '导演', '摄影师', '化妆师', '服务员', '程序员', '工程师', '设计师', '快递员']),
    neg: ['人员', '成员', '会员', '动员', '工作人员', ...TOP_NOISE.slice(0, 7)] },
  { kind: 'relation',
    pos: pos(['朋友', '好友', '闺蜜', '恋人', '情人', '男友', '女友', '同事', '同学', '伙伴', '搭档', '邻居', '客户', '对手', '敌人', '室友']),
    neg: ['妈妈', '哥哥', ...TOP_NOISE.slice(0, 10)] },

  { kind: 'building',
    pos: pos(['大楼', '高楼', '居民楼', '铁塔', '大桥', '宫殿', '寺庙', '凉亭', '别墅', '大厦', '公寓', '教堂', '城堡', '电梯', '楼梯', '屋顶']),
    neg: ['课堂', '天堂', '进城', '全城', '街坊', '内阁', ...TOP_NOISE.slice(0, 6)] },
  { kind: 'room',
    pos: pos(['卧室', '客厅', '厨房', '浴室', '书房', '卫生间', '办公室', '会议室', '教室', '阳台', '走廊', '更衣室', '大厅', '客房', '病房', '房间']),
    neg: ['时间', '中间', '瞬间', '之间', '房子', '门口', ...TOP_NOISE.slice(0, 6)] },
  { kind: 'nature',
    pos: pos(['高山', '火山', '大海', '河流', '湖泊', '树林', '森林', '小岛', '山峰', '悬崖', '溪流', '温泉', '沙滩', '天空', '太阳', '月亮']),
    neg: ['脑海', '人海', '花海', '苦海', '学海', '上山', '下山', ...TOP_NOISE.slice(0, 5)] },

  { kind: 'food',
    pos: pos(['米饭', '面条', '面包', '蛋糕', '饺子', '包子', '早餐', '晚餐', '水果', '蔬菜', '火锅', '牛肉', '蔬菜汤', '白粥', '月饼', '米粥']),
    neg: ['肌肉', '吃饭', '做饭', '点菜', '炒菜', '喝汤', ...TOP_NOISE.slice(0, 6)] },
  { kind: 'drink',
    pos: pos(['咖啡', '红茶', '绿茶', '奶茶', '牛奶', '果汁', '可乐', '啤酒', '白酒', '红酒', '香槟', '矿泉水', '热水', '饮料', '酒精', '温水']),
    neg: ['喝酒', '敬酒', '品茶', '倒酒', ...TOP_NOISE.slice(0, 8)] },
  { kind: 'furniture',
    pos: pos(['桌子', '椅子', '沙发', '书桌', '餐桌', '茶几', '衣柜', '书架', '抽屉', '板凳', '台灯', '窗帘', '枕头', '床单', '圆桌', '木椅']),
    neg: ['同桌', '上桌', '合同', '电话', '剧组', '项目', '平台', '消息', '屏幕', '名字', '电视', '手机'] },
  { kind: 'container',
    pos: pos(['玻璃杯', '保温杯', '水杯', '茶杯', '盘子', '瓶子', '箱子', '盒子', '罐子', '水壶', '篮子', '水桶', '花瓶', '行李箱', '塑料袋', '口袋']),
    neg: ['脑袋', '键盘', '音箱', '邮箱', '棋盘', '地盘', ...TOP_NOISE.slice(0, 6)] },
  { kind: 'vehicle',
    pos: pos(['汽车', '出租车', '公交车', '地铁', '火车', '飞机', '摩托车', '自行车', '轿车', '卡车', '警车', '轮船', '游艇', '快艇', '马车', '跑车']),
    neg: ['开车', '停车', '上车', '下车', '打车', '堵车', '刹车', ...TOP_NOISE.slice(0, 5)] },

  { kind: 'body',
    pos: pos(['头发', '脸颊', '眼睛', '鼻子', '嘴唇', '肩膀', '手臂', '手指', '胸口', '腰部', '臀部', '背部', '裆部', '大腿', '膝盖', '皮肤']),
    neg: ['中部', '内部', '外部', '底部', '根部', '尾部', '门口', '出口', '入口', '路口', '合同', '电话'] },
  { kind: 'color',
    pos: pos(['红色', '黑色', '白色', '蓝色', '绿色', '黄色', '紫色', '灰色', '金色', '银色', '深蓝', '漆黑', '苍白', '乌黑', '墨绿', '肤色']),
    neg: ['角色', '神色', '脸色', '景色', '出色', '特色', '气色', '音色', '姿色', '好色', '合同', '电话'] },
  { kind: 'emotion',
    pos: pos(['高兴', '开心', '兴奋', '激动', '愤怒', '生气', '紧张', '害怕', '恐惧', '悲伤', '难过', '伤心', '痛苦', '失望', '委屈', '尴尬']),
    neg: [...TOP_NOISE] },

  { kind: 'money',
    pos: pos(['工资', '现金', '押金', '房租', '红包', '零钱', '钞票', '硬币', '信用卡', '账单', '发票', '医药费', '手续费', '服务费', '一万元', '五块钱']),
    neg: ['免费', '消费', '浪费', '白费', '花钱', '赚钱', '分成', ...TOP_NOISE.slice(0, 6)] },
  { kind: 'org',
    pos: pos(['公司', '集团', '学校', '大学', '学院', '医院', '银行', '政府', '部门', '协会', '剧组', '工作室', '事务所', '研究所', '法院', '军队']),
    neg: ['合同', '电话', '项目', '平台', '消息', '屏幕', '名字', '电视', '桌子', '沙发', '抽屉', '筷子'] },
];

/* ---------- Batch 3: the 20 kinds that take docs/33 from 25 to 45 ----------
   Same contract as batch 2 — >= 12 positives, >= 12 negatives, negatives drawn
   from the local TOP-200 vocabulary plus the confusables each suffix invites
   (意味 vs 香味, 矛盾 vs 盾牌, 我想 vs 想法). Only word forms are written down. */

/** Words seen in the head of the local TOP list that are not any of the batch-3 kinds. */
const TOP_NOISE3 = ['剧组', '项目', '平台', '消息', '名字', '合同', '导演', '演员', '预算', '渠道', '档期', '片酬'];

const BATCH3: KindCase[] = [
  { kind: 'material',
    pos: pos(['木头', '玻璃', '塑料', '陶瓷', '大理石', '棉花', '丝绸', '皮革', '牛皮', '亚麻', '帆布', '水泥', '青铜', '黄金', '布料', '蕾丝']),
    neg: ['本质', '性质', '素质', '材料', '资料', '照料', '饮料', '燃料', ...TOP_NOISE3.slice(0, 5)] },
  { kind: 'plant',
    pos: pos(['大树', '柳树', '槐树', '梧桐树', '野草', '青草', '树叶', '落叶', '树枝', '藤蔓', '玫瑰', '樱花', '牡丹', '仙人掌', '蘑菇', '花瓣']),
    neg: ['潦草', '起草', '爆竹', '烟花', '火花', '浪花', '雪花', '泪花', ...TOP_NOISE3.slice(0, 5)] },
  { kind: 'animal',
    pos: pos(['猫', '狗', '猫咪', '老虎', '狮子', '狐狸', '老鼠', '蛇', '龙', '大象', '蝴蝶', '蜜蜂', '鲨鱼', '母马', '宠物', '兔子']),
    neg: ['马路', '牛奶', '龙头', '虎口', '猫腻', '鸡蛋', '鱼肉', '海鲜', ...TOP_NOISE3.slice(0, 5)] },
  { kind: 'weather',
    pos: pos(['大雨', '暴雨', '细雨', '雷雨', '大雪', '风雪', '大风', '狂风', '台风', '浓雾', '闪电', '晴天', '阴天', '彩虹', '露水', '天气']),
    neg: ['血雨', '泪雨', '洗雪', '作风', '家风', '通风', '中风', '雪花', ...TOP_NOISE3.slice(0, 5)] },

  { kind: 'device',
    pos: pos(['手机', '电脑', '相机', '屏幕', '键盘', '耳机', '音箱', '充电器', '洗衣机', '吹风机', '打印机', '摄像机', '遥控器', '显示器', '路由器', '监视器']),
    neg: ['危机', '时机', '动机', '生机', '机会', '趁机', '器官', '武器', '容器', '乐器', '直升机', '生殖器'] },
  { kind: 'weapon',
    pos: pos(['匕首', '手枪', '步枪', '长剑', '宝剑', '军刀', '战斧', '盾牌', '弓箭', '子弹', '炸弹', '导弹', '大炮', '长矛', '铁锤', '武器']),
    neg: ['矛盾', '开枪', '中枪', '鞭炮', '放炮', '反弹', '回弹', '剪刀', ...TOP_NOISE3.slice(0, 5)] },
  { kind: 'jewelry',
    pos: pos(['戒指', '项链', '耳环', '耳坠', '手镯', '玉镯', '手链', '胸针', '发簪', '玉佩', '吊坠', '首饰', '珠宝', '钻戒', '婚戒', '佛珠']),
    neg: ['衬衫', '外套', '裙子', '皮带', '围巾', '手套', ...TOP_NOISE3.slice(0, 6)] },

  { kind: 'sound',
    pos: pos(['笑声', '哭声', '脚步声', '呼吸声', '关门声', '铃声', '掌声', '枪声', '巨响', '声响', '声音', '噪音', '嗓音', '口音', '尖叫', '呐喊']),
    neg: ['名声', '影响', '音响', '交响', '反响', '大声', '低声', '轻声', '出声', '齐声', '合同', '剧组'] },
  { kind: 'smell',
    pos: pos(['香味', '气味', '酒味', '血腥味', '汗味', '霉味', '臭味', '腥味', '幽香', '清香', '芳香', '香气', '香水', '味道', '气息', '檀香']),
    neg: ['意味', '品味', '趣味', '回味', '乏味', '兴味', '美味', '口味', '滋味', '烧香', '合同', '剧组'] },
  { kind: 'texture',
    pos: pos(['冰凉', '冰冷', '温热', '滚烫', '灼热', '柔软', '光滑', '顺滑', '粗糙', '坚硬', '僵硬', '湿润', '潮湿', '干燥', '黏腻', '细腻']),
    neg: ['温柔', '冷漠', '热情', '冷静', '好看', '干净', ...TOP_NOISE3.slice(0, 6)] },
  { kind: 'illness',
    pos: pos(['伤口', '伤疤', '刀伤', '外伤', '创伤', '骨折', '高烧', '发烧', '感冒', '咳嗽', '疾病', '毛病', '后遗症', '炎症', '头痛', '腹痛']),
    neg: ['悲伤', '哀伤', '忧伤', '中伤', '受伤', '生病', '看病', '治病', '心痛', '悲痛', '合同', '剧组'] },

  { kind: 'speech',
    pos: pos(['说道', '问道', '答道', '喊道', '笑道', '骂道', '说话', '对话', '交谈', '聊天', '争吵', '解释', '警告', '抱怨', '低语', '语气']),
    neg: ['知道', '味道', '街道', '难道', '频道', '跑道', '通道', '报道', ...TOP_NOISE3.slice(0, 5)] },
  { kind: 'thought',
    pos: pos(['念头', '记忆', '回忆', '思念', '想念', '幻想', '梦想', '猜想', '想法', '心思', '思绪', '直觉', '错觉', '印象', '灵感', '想象']),
    neg: ['我想', '你想', '他想', '不想', '没想', '别想', '要想', '休想', '纪念', '悬念', '合同', '剧组'] },
  { kind: 'desire',
    pos: pos(['欲望', '食欲', '性欲', '情欲', '私欲', '占有欲', '控制欲', '求知欲', '渴望', '愿望', '冲动', '贪婪', '野心', '执念', '渴求', '憧憬']),
    neg: ['失望', '绝望', '无望', '观望', '遥望', '眺望', ...TOP_NOISE3.slice(0, 6)] },

  { kind: 'document',
    pos: [...pos(['文件', '名片', '简历', '报告', '名单', '清单', '账单', '发票', '说明书', '保证书', '身份证', '复印件', '邀请函']),
      ...posSoft(['合同', '协议', '通告单'])],
    neg: ['简单', '不简单', '保证', '不保证', '事件', '条件', '零件', '软件', '硬件', '秘书', '床单', '证明',
      // 量词短语: 穿一件 reached the local TOP 200 as a 文书 before the fix
      '穿一件', '那一件', '三份单'] },
  { kind: 'media',
    pos: [...pos(['电视剧', '喜剧', '悲剧', '话剧', '歌曲', '舞曲', '插曲', '电影', '小说', '综艺', '专辑', '纪录片', '漫画', '杂志', '报纸']),
      ...posSoft(['台词'])],
    neg: ['加剧', '急剧', '恶作剧', '弯曲', '扭曲', '蜷曲', ...TOP_NOISE3.slice(0, 6)] },
  { kind: 'event',
    pos: [...pos(['婚礼', '葬礼', '典礼', '庆典', '比赛', '决赛', '球赛', '仪式', '会议', '发布会', '演唱会', '宴会', '聚会', '拍摄', '杀青']),
      ...posSoft(['开幕式'])],
    neg: ['敬礼', '行礼', '送礼', '失礼', '委员会', '基金会', '方程式', '表达式', '机会', '社会', '误会', '方式'] },

  { kind: 'myth',
    pos: pos(['神仙', '仙人', '恶魔', '心魔', '妖怪', '狐妖', '神明', '神灵', '女神', '天使', '幽灵', '精灵', '僵尸', '魔法', '咒语', '灵魂']),
    neg: ['水仙', '入魔', '着魔', '精神', '眼神', '走神', '心灵', '机灵', '奇怪', '古怪', '难怪', '见鬼'] },
  { kind: 'martial',
    pos: pos(['口诀', '心诀', '剑诀', '内力', '真气', '内功', '武功', '招式', '剑法', '心法', '秘籍', '灵石', '丹药', '修为', '境界', '筑基']),
    neg: ['秘诀', '成功', '用功', '生气', '语气', '运气', '牡丹', '天气', ...TOP_NOISE3.slice(0, 5)] },
  { kind: 'festival',
    pos: pos(['春节', '元旦', '除夕', '新年', '中秋', '端午', '清明', '七夕', '圣诞', '元宵', '腊八', '圣诞节', '情人节', '中秋节', '国庆节', '万圣节']),
    neg: ['细节', '环节', '关节', '章节', '情节', '季节', '调节', '节目', ...TOP_NOISE3.slice(0, 5)] },
];
BATCH2.push(...BATCH3);

/* ---------- Batch 4: additive tags below `event` (docs/33 unimplemented rows) ----------
   Same contract — ≥ 12 positives, ≥ 12 negatives. Number constructions that are
   already DEFAULT_STOPWORDS / DEMO_CLASSIFIER (一个 这只 几个) are negatives, not
   positives. Region and path are extra tags on top of `place`; they must not
   steal 朝阳区 / 马路. */

const TOP_NOISE4 = ['剧组', '项目', '平台', '消息', '名字', '合同', '导演', '演员', '预算', '渠道', '档期', '片酬'];

const BATCH4: KindCase[] = [
  { kind: 'onomatopoeia',
    pos: pos(['砰砰', '咚咚', '嗡嗡', '哗啦', '叮当', '咔嚓', '啪啪', '咯吱', '呼呼', '哗哗', '扑通', '轰隆', '叮咚', '滴答', '喵喵', '汪汪']),
    neg: ['哥哥', '爸爸', '妈妈', '姐姐', '往往', '渐渐', '慢慢', '常常', '看看', '谢谢', '想想', '说说'] },
  { kind: 'measure',
    pos: pos(['厘米', '公斤', '毫升', '公里', '千克', '毫米', '公顷', '英寸', '英尺', '海里', '摄氏度', '平方厘米', '立方米', '公升', '毫克', '千米']),
    neg: ['米饭', '米粒', '过来', '温度', '大米', '小米', '度过', '过度', ...TOP_NOISE4.slice(0, 4)] },
  { kind: 'ethnicity',
    pos: pos(['中国人', '法国人', '美国人', '日本人', '韩国人', '汉族', '苗族', '满族', '回族', '藏族', '精灵族', '兽人', '魔族', '人族', '英国人', '德国人']),
    neg: ['工人', '主人', '家人', '大人', '女人', '男人', '老人', '好人', '坏人', '情人', '友人', '证人'] },
  { kind: 'rank',
    pos: pos(['上校', '中尉', '上尉', '少校', '元帅', '伯爵', '公爵', '侯爵', '男爵', '亲王', '国王', '皇帝', '筑基期', '金丹期', '元婴期', '上将']),
    neg: ['阶级', '超级', '等级', '时期', '长期', '期待', '手段', '地段', '陛下', '升级', '班级', '年级'] },
  { kind: 'law',
    pos: pos(['法律', '刑法', '民法', '宪法', '条款', '罪名', '谋杀罪', '盗窃罪', '违约', '侵权', '诉讼', '判决', '犯罪', '婚姻法', '劳动法', '合同法']),
    neg: ['办法', '想法', '看法', '说法', '方法', '魔法', '书法', '剑法', '法院', '法官', '罪过', '得罪'] },
  { kind: 'number',
    pos: pos(['三十万', '一百', '两千', '上百', '成千上万', '半数', '三成', '百分之十', '两万', '百万', '三个', '四张', '五条', '六杯', '八辆', '三十个']),
    neg: ['一个', '几个', '一些', '一点', '一次', '这只', '那个', '第一', '第二', '一半', '完成', '成功'] },
  { kind: 'region',
    pos: pos(['朝阳区', '开发区', '中国', '美国', '英国', '法国', '日本', '韩国', '河北省', '上海市', '海淀区', '河南省', '纽约州', '共和国', '北京市', '四川省']),
    neg: ['误区', '社区', '时区', '音区', '办公室', '盲区', '联合国', '门口', '超市', '市场', '节省', '上市'] },
  { kind: 'path',
    pos: pos(['高速公路', '立交桥', '十字路口', '人行道', '马路', '街道', '车站', '地铁站', '柏油路', '公交站', '火车站', '商业街', '步行街', '公路', '铁路', '道路']),
    neg: ['门口', '胸口', '虎口', '接口', '路口', '知道', '味道', '难道', '网站', '工作站', '不知道', '大桥'] },
];
BATCH2.push(...BATCH4);

for (const c of BATCH2) NEW_KINDS.push(measure(c.kind, c.pos, c.neg));
console.log('');
for (const r of NEW_KINDS) {
  const weak = r.precision < 0.8;
  const declared = EXPERIMENTAL_KINDS.includes(r.kind);
  if (weak && !declared) {
    console.log(`❌ ${ENTITY_LABEL[r.kind]} 精度 ${(r.precision * 100).toFixed(1)}% < 80%，但没写进 EXPERIMENTAL_KINDS`);
    bad++;
  } else if (!weak && declared) {
    console.log(`（${ENTITY_LABEL[r.kind]} 精度已达 ${(r.precision * 100).toFixed(1)}%，可以从 EXPERIMENTAL_KINDS 里去掉）`);
  } else if (weak) {
    console.log(`⚠️  ${ENTITY_LABEL[r.kind]} 精度 ${(r.precision * 100).toFixed(1)}%，已标为实验`);
  }
}

if (bad) {
  console.log(`\n❌ 不通过：${bad} 项`);
  process.exit(1);
}
console.log('\n✅ 通过：负例全部拒绝，门禁正例全部保留，新类精度与实验标注一致');
