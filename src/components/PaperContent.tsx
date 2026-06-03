import { isSupportedVisualKind, visualKindMatchesRegistry } from '../visualTemplates.js';

export default function PaperContent({ content, maxHeight = '' }: { content: string; maxHeight?: string }) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  let currentQuestion = '';
  return (
    <div className={`space-y-2 overflow-auto rounded-2xl border border-gray-100 bg-gray-50 p-5 text-[14px] leading-7 text-gray-800 ${maxHeight}`}>
      {lines.map((line, index) => {
        const text = line.trim();
        const visual = parseVisualLine(line);
        if (visual) {
          if (!visualMatchesQuestion(visual.kind, currentQuestion)) return null;
          return <VisualBlock key={`${line}-${index}`} visual={visual} />;
        }
        if (isQuestionLine(text)) currentQuestion = text;
        if (!text) return <div key={index} className="h-3" />;
        return <p key={index} className="whitespace-pre-wrap">{line}</p>;
      })}
    </div>
  );
}

function parseVisualLine(line: string) {
  const matched = line.trim().match(/^\[图:([a-z_]+)\s*([^\]]*)\]$/i);
  if (!matched) return null;
  const attrs = Object.fromEntries(
    matched[2].trim().split(/\s+/).filter(Boolean).map((part) => {
      const [key, ...rest] = part.split('=');
      return [key, rest.join('=')];
    }).filter(([key, value]) => key && value)
  );
  return { kind: matched[1], attrs };
}

function isQuestionLine(text = '') {
  return /^\d+\s*[.、]\s*/.test(text.trim());
}

function visualMatchesQuestion(kind = '', question = '') {
  const type = String(kind || '').toLowerCase();
  const text = String(question || '');
  if (type === 'source_image') return /如图|下图|图中|图形|观察图|看图/.test(text);
  if (type === 'clock') return /钟面|分针|时整|点钟|钟表|时针.*分针|分针.*时针/.test(text);
  if (type === 'triangle_board') return canUseTriangleBoardTemplate(text);
  if (type === 'triangle_board_composition') return isTriangleBoardCompositionText(text);
  if (type === 'triangle_board_overlap') return isTriangleBoardOverlapText(text);
  if (type === 'pattern') return /规律|序列|气球|颜色|排列|第\s*\d+\s*个|红|蓝|绿|黄|紫|橙/.test(text);
  if (type === 'tile_pattern') return /黑白|黑砖|白砖|瓷砖|方块|方格|正方形|矩形地面/.test(text);
  if (type === 'overlap_rect') return isOverlapRectText(text);
  if (type === 'stack_cups') return /杯子/.test(text) && /叠起来|叠放|摞起来|高度/.test(text);
  if (type === 'rect_path') return /长方形.*ABCD|ABCD.*长方形|点P|沿.*边|路径|A\s*[→>-]\s*D|逆时针/.test(text);
  return visualKindMatchesRegistry(type, text);
}

function isOverlapRectText(text = '') {
  const value = String(text || '');
  const hasPaperStrip = /纸条|纸带|长方形纸|矩形纸/.test(value);
  const hasOverlapAction = /重叠|重合|粘贴|首尾相接/.test(value);
  const hasLengthClue = /总长度|总长|长\s*\d+|宽\s*\d+|\d+\s*(?:厘米|cm)/i.test(value);
  return hasPaperStrip && (hasOverlapAction || /总长度|总长/.test(value)) && hasLengthClue;
}

function canUseTriangleBoardTemplate(text = '') {
  const value = String(text || '');
  if (!/三角板|拼角/.test(value)) return false;
  if (isComplexTriangleBoardText(value)) return false;
  return /\d{1,3}\s*°/.test(value) && !/如下图|如图|下图|图中/.test(value);
}

function isComplexTriangleBoardText(text = '') {
  const value = String(text || '');
  const angleRefs = value.match(/∠\s*\d/g) || [];
  const hasTriangleBoard = /三角板|∠/.test(value);
  const hasPlacement = /一副三角板|三角板.*(?:拼成|拼接|摆放|组合)|(?:拼成|拼接|摆放|组合).*三角板/.test(value);
  const asksMultipleUnknownAngles = angleRefs.length >= 2 || /∠\s*1.*∠\s*2|∠\s*2.*∠\s*3/.test(value);
  const imageDependent = /如下图|如图|下图|图中/.test(value) && hasTriangleBoard && /拼成|拼接|摆放|组合|∠\s*\d/.test(value);
  return hasPlacement || asksMultipleUnknownAngles || imageDependent;
}

function isTriangleBoardCompositionText(text = '') {
  const value = String(text || '');
  if (!/三角板/.test(value)) return false;
  const hasComposition = /一副三角板|拼成|拼接|摆放|叠放|重合|重叠|组合/.test(value);
  const angleRefs = [...new Set((value.match(/∠\s*(?:\d|α|β)/g) || []).map((item) => item.replace(/\s+/g, '')))];
  const asksMultipleAngles = angleRefs.length >= 2 || /∠\s*1.*∠\s*2|∠\s*2.*∠\s*3|∠\s*1[、,，]\s*∠\s*2|计算.*∠\s*1.*∠\s*2/.test(value);
  const allowedAngles = new Set([30, 45, 60, 90]);
  const normalized = value.replace(/直角/g, '90°');
  const combine = /(\d{1,3})\s*°[^0-9°]{0,16}(?:和|与|加|[+＋]|拼|连同|相加)[^0-9°]{0,16}(\d{1,3})\s*°/.exec(normalized);
  const subtract = /(\d{1,3})\s*°[^0-9°]{0,16}(?:减去?|差|[-－])[^0-9°]{0,16}(\d{1,3})\s*°/.exec(normalized);
  const bigSmall = /大角\s*(?:为|是|=)?\s*(\d{1,3})\s*°[\s\S]{0,40}?小角\s*(?:为|是|=)?\s*(\d{1,3})\s*°[\s\S]{0,40}?(?:差|差角|差是|相差)/.exec(normalized);
  const isAllowedPair = (match: RegExpExecArray | null) => Boolean(match && allowedAngles.has(Number(match[1])) && allowedAngles.has(Number(match[2])));
  const hasExplicitRelation =
    isAllowedPair(combine) ||
    isAllowedPair(subtract) ||
    isAllowedPair(bigSmall) ||
    /(?:平角|180\s*°?).*(?:减|差|[-－])\s*45\s*°?/.test(value) ||
    /最小锐角|含\s*30\s*°?\s*角.*最小/.test(value);
  return hasComposition && hasExplicitRelation && !asksMultipleAngles;
}

function isTriangleBoardOverlapText(text = '') {
  const value = String(text || '');
  if (!/三角板/.test(value)) return false;
  const hasSharedVertex = /(?:直角顶点|顶点)\s*(?:重合|重叠|共点|相重合|重叠在一起|重叠摆放)/.test(value);
  const hasPlacementContext = /一副三角板|按图示|按图所示|图示方式|图所示摆放/.test(value);
  const twoRightAngleMarkers = (value.match(/∠\s*[A-Z]\s*O\s*[A-Z]\s*[=＝]\s*90\s*°?/g) || []).length >= 2;
  const hasOuterAngleMatch = [...value.matchAll(/∠\s*[A-Z]\s*O\s*[A-Z]\s*[=＝]\s*(\d{2,3})\s*°/g)]
    .map((match) => Number(match[1]))
    .some((angle) => angle > 90 && angle < 180);
  if (!hasOuterAngleMatch) return false;
  return hasSharedVertex || (hasPlacementContext && twoRightAngleMarkers);
}

function VisualBlock({ visual }: any) {
  const Renderer = visualRenderers[visual.kind];
  return (
    <div className="my-3 rounded-xl border border-blue-100 bg-white p-4">
      {Renderer ? <Renderer attrs={visual.attrs} /> : (
        <p className="text-[13px] text-gray-500">
          {isSupportedVisualKind(visual.kind) ? '该图形类型已登记，但还没有前端渲染器，需先补渲染实现。' : '该图形类型不在白名单内，需使用单题截图或原始图片。'}
        </p>
      )}
    </div>
  );
}

const visualRenderers: Record<string, any> = {
  clock: ClockVisual,
  triangle_board: TriangleBoardVisual,
  triangle_board_composition: TriangleBoardCompositionVisual,
  triangle_board_overlap: TriangleBoardOverlapVisual,
  pattern: PatternVisual,
  tile_pattern: TilePatternVisual,
  overlap_rect: OverlapRectVisual,
  stack_cups: StackCupsVisual,
  rect_path: RectPathVisual,
  source_image: SourceImageVisual,
};

function SourceImageVisual({ attrs }: any) {
  const url = String(attrs.url || attrs.src || '').trim();
  if (!url) {
    return <p className="text-[13px] text-gray-500">复杂图形题未找到原始图片。</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
      <img className="max-h-72 w-full object-contain" src={url} alt="原始题图" />
    </div>
  );
}

function ClockVisual({ attrs }: any) {
  const hour = Number(attrs.hour || 5);
  const minute = Number(attrs.minute || 0);
  const angle = attrs.angle ? `${attrs.angle}°` : '';
  const hourDeg = ((hour % 12) + minute / 60) * 30 - 90;
  const minuteDeg = minute * 6 - 90;
  const point = (deg: number, len: number) => {
    const rad = deg * Math.PI / 180;
    return { x: 80 + Math.cos(rad) * len, y: 80 + Math.sin(rad) * len };
  };
  const hp = point(hourDeg, 36);
  const mp = point(minuteDeg, 54);
  return (
    <svg className="h-44 w-full max-w-xs" viewBox="0 0 180 170" role="img" aria-label="钟面图">
      <circle cx="80" cy="80" r="64" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, index) => {
        const value = index + 1;
        const p = point(value * 30 - 90, 50);
        return <text key={value} x={p.x} y={p.y + 4} textAnchor="middle" className="fill-slate-700 text-[10px] font-bold">{value}</text>;
      })}
      <line x1="80" y1="80" x2={hp.x} y2={hp.y} stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
      <line x1="80" y1="80" x2={mp.x} y2={mp.y} stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
      <circle cx="80" cy="80" r="5" fill="#2563eb" />
      {angle && <text x="118" y="76" className="fill-blue-600 text-[14px] font-bold">{angle}</text>}
    </svg>
  );
}

function TriangleBoardVisual({ attrs }: any) {
  const angles = String(attrs.angles || '75,135,150').split(',').filter(Boolean);
  return (
    <svg className="h-40 w-full max-w-lg" viewBox="0 0 420 140" role="img" aria-label="三角板角度图">
      {[
        [[20, 110], [120, 110], [72, 25]],
        [[165, 25], [265, 110], [165, 110]],
        [[300, 110], [400, 110], [352, 25]],
      ].map((points, index) => (
        <g key={index}>
          <polygon points={points.map((point) => point.join(',')).join(' ')} fill="#dbeafe" stroke="#64748b" strokeWidth="2" />
          <circle cx={points[2][0]} cy={points[2][1] + 14} r="7" fill="#fff" stroke="#64748b" />
          <text x={points[0][0] + 22} y={points[0][1] + 20} className="fill-blue-700 text-[14px] font-bold">∠{index + 1}={angles[index] || '?'}°</text>
        </g>
      ))}
    </svg>
  );
}

function TriangleBoardCompositionVisual({ attrs }: any) {
  const angles = parseList(attrs.angles, ['105']).slice(0, 1);
  const relations = parseList(attrs.relations, ['60+45']).slice(0, 1);
  const labels = parseList(attrs.labels, ['1']).slice(0, 1);
  const angleStr = angles[0] || '105';
  const relation = relations[0] || '60+45';
  const label = labels[0] || '1';

  // 解析关系 a+b 或 a-b
  const isSubtract = /[-－]/.test(relation);
  const parts = relation.split(/[+＋\-－]/).map((part) => Number(String(part).trim()) || 0);
  const aRaw = parts[0] || 60;
  const bRaw = parts[1] || 45;
  // 减法时让 a 是大角、b 是小角
  const a = isSubtract ? Math.max(aRaw, bRaw) : aRaw;
  const b = isSubtract ? Math.min(aRaw, bRaw) : bRaw;

  // 几何：两板共顶点 O，共边沿向上
  // + 模式：板 1 在左偏 a°、板 2 在右偏 b°，拼成的角 ∠label=a+b 在外
  // - 模式：板 1 在左偏 a°、板 2 也在左偏 b°（b 在 a 内），差角 ∠label=a-b 在两板未重合边之间
  const cx = 220;
  const cy = 220;
  const commonLeg = 140;

  // 板形状：共顶点 O=(cx,cy)，共边末端 P=(cx, cy-commonLeg)
  // angleAtO != 90 → 直角在 P，第三点沿水平在 P 旁，距离 P = commonLeg * cot(angleAtO)
  // angleAtO == 90 → 直角在 O，第三点沿水平在 O 旁，距离 O = commonLeg
  const buildBoard = (sgn: number, angleAtO: number) => {
    const O: [number, number] = [cx, cy];
    const P: [number, number] = [cx, cy - commonLeg];
    if (angleAtO === 90) {
      const otherLeg = commonLeg;
      const L: [number, number] = [cx + sgn * otherLeg, cy];
      return { O, P, L, rightAngleAt: 'O' as const };
    }
    const cot = 1 / Math.tan((angleAtO * Math.PI) / 180);
    const L: [number, number] = [cx + sgn * commonLeg * cot, cy - commonLeg];
    return { O, P, L, rightAngleAt: 'P' as const };
  };

  const sgn1 = -1;
  const sgn2 = isSubtract ? -1 : 1;
  const board1 = buildBoard(sgn1, a);
  const board2 = buildBoard(sgn2, b);

  const rightMark = (board: ReturnType<typeof buildBoard>) => {
    const size = 9;
    const pivot = board.rightAngleAt === 'O' ? board.O : board.P;
    const dx = board.rightAngleAt === 'O' ? (board.L[0] > pivot[0] ? size : -size) : (board.L[0] > pivot[0] ? size : -size);
    const dy = board.rightAngleAt === 'O' ? -size : size;
    return (
      <polyline
        points={`${pivot[0] + dx},${pivot[1]} ${pivot[0] + dx},${pivot[1] + dy} ${pivot[0]},${pivot[1] + dy}`}
        fill="none"
        stroke="#475569"
        strokeWidth="1.5"
      />
    );
  };

  const points = (board: ReturnType<typeof buildBoard>) => [board.O, board.P, board.L].map((p) => p.join(',')).join(' ');

  // 大角 ∠label 的弧位置：在 O 点，从板 1 的 L 方向到板 2 的 L 方向
  // 用角度对应 svg 极坐标（y 轴向下）
  const arcRadius = 32;
  const polarFromO = (svgAngleDeg: number, r: number): [number, number] => [
    cx + Math.cos((svgAngleDeg * Math.PI) / 180) * r,
    cy + Math.sin((svgAngleDeg * Math.PI) / 180) * r
  ];
  // 板 1 的 L 在 O 的左上方，对应 svg 角 = 180 + a/2 调整
  // 用向量 (L1-O) 计算实际角
  const angleOf = (from: [number, number], to: [number, number]) => {
    const ax = to[0] - from[0];
    const ay = to[1] - from[1];
    return (Math.atan2(ay, ax) * 180) / Math.PI;
  };
  const angle1 = angleOf(board1.O, board1.L);
  const angle2 = angleOf(board2.O, board2.L);
  const arcStart = polarFromO(angle1, arcRadius);
  const arcEnd = polarFromO(angle2, arcRadius);
  // 大角弧方向：sweep=1 即顺时针在 svg 中（数学逆时针），从 angle1 → angle2 走外侧
  const arcPath = `M ${arcStart[0]} ${arcStart[1]} A ${arcRadius} ${arcRadius} 0 0 ${isSubtract ? 0 : 1} ${arcEnd[0]} ${arcEnd[1]}`;
  const symbol = isSubtract ? '−' : '+';

  return (
    <svg className="h-64 w-full max-w-md" viewBox="0 0 440 270" role="img" aria-label="三角板拼角图">
      <polygon points={points(board1)} fill="#bfdbfe" fillOpacity="0.7" stroke="#1d4ed8" strokeWidth="2" />
      <polygon points={points(board2)} fill="#bbf7d0" fillOpacity="0.7" stroke="#15803d" strokeWidth="2" />
      {rightMark(board1)}
      {rightMark(board2)}
      <path d={arcPath} fill="none" stroke="#dc2626" strokeWidth="2.5" />
      <circle cx={cx} cy={cy} r="4" fill="#0f172a" />
      <text x={cx - 14} y={cy + 14} className="fill-slate-700 text-[12px] font-bold">O</text>
      <text x={cx} y={cy + 36} textAnchor="middle" className="fill-red-600 text-[15px] font-bold">∠{label} = {a}°{symbol}{b}° = {angleStr}°</text>
    </svg>
  );
}

function TriangleBoardOverlapVisual({ attrs }: any) {
  const aodRaw = Number(attrs.aod ?? attrs.angle);
  const bocRaw = Number(attrs.boc);
  let aod = Number.isFinite(aodRaw) ? aodRaw : (Number.isFinite(bocRaw) ? 180 - bocRaw : 150);
  aod = Math.max(91, Math.min(179, aod));
  const labels = parseList(attrs.labels, ['A', 'B', 'C', 'D']).slice(0, 4);
  while (labels.length < 4) labels.push(['A', 'B', 'C', 'D'][labels.length]);
  const kind1 = normalizeBoardKind(attrs.kind1, 45);
  const kind2 = normalizeBoardKind(attrs.kind2, 30);

  const cx = 220;
  const cy = 168;
  const legLong = 130;
  const legShort = legLong * Math.tan(30 * Math.PI / 180);

  const polar = (deg: number, len: number) => {
    const rad = deg * Math.PI / 180;
    return [cx + Math.cos(rad) * len, cy - Math.sin(rad) * len];
  };

  const alphaA = 90 + aod / 2;
  const alphaD = 90 - aod / 2;
  const alphaB = alphaA - 90;
  const alphaC = alphaD + 90;

  const board = (alphaOuter: number, alphaInner: number, kind: number, fill: string, stroke: string) => {
    const outerLen = kind === 30 ? legLong : legLong;
    const innerLen = kind === 30 ? legShort : legLong;
    const outer = polar(alphaOuter, outerLen);
    const inner = polar(alphaInner, innerLen);
    return { outer, inner, points: [[cx, cy], outer, inner] };
  };

  const t1 = board(alphaA, alphaB, kind1, '#bfdbfe', '#1d4ed8');
  const t2 = board(alphaD, alphaC, kind2, '#fed7aa', '#c2410c');

  const arcPath = (alphaHigh: number, alphaLow: number, radius: number) => {
    const start = polar(alphaHigh, radius);
    const end = polar(alphaLow, radius);
    return `M ${start[0]} ${start[1]} A ${radius} ${radius} 0 0 0 ${end[0]} ${end[1]}`;
  };

  const aodArcRadius = 50;
  const bocArcRadius = 22;
  const aodLabelPos = [cx + 80, cy - 12];
  const bocLabelPos = [cx - 80, cy - 12];

  const labelPos = (alpha: number, len: number) => {
    const [x, y] = polar(alpha, len + 18);
    return { x, y };
  };
  const aPos = labelPos(alphaA, legLong);
  const bPos = labelPos(alphaB, kind1 === 30 ? legLong : legLong);
  const cPos = labelPos(alphaC, kind2 === 30 ? legShort : legLong);
  const dPos = labelPos(alphaD, legLong);

  const points = (pts: number[][]) => pts.map((p) => p.join(',')).join(' ');

  return (
    <svg className="h-56 w-full max-w-md" viewBox="0 0 440 220" role="img" aria-label="两块三角板共直角顶点图">
      <polygon points={points(t2.points)} fill={'#fed7aa'} fillOpacity="0.85" stroke="#c2410c" strokeWidth="2" />
      <polygon points={points(t1.points)} fill={'#bfdbfe'} fillOpacity="0.75" stroke="#1d4ed8" strokeWidth="2" />
      <path d={arcPath(alphaA, alphaD, aodArcRadius)} fill="none" stroke="#0f172a" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x={aodLabelPos[0]} y={aodLabelPos[1]} textAnchor="middle" className="fill-slate-800 text-[12px] font-bold">∠{labels[0]}O{labels[3]}={aod}°</text>
      <path d={arcPath(alphaC, alphaB, bocArcRadius)} fill="none" stroke="#dc2626" strokeWidth="2" />
      <text x={bocLabelPos[0]} y={bocLabelPos[1]} textAnchor="middle" className="fill-red-600 text-[12px] font-bold">∠{labels[1]}O{labels[2]}</text>
      <circle cx={cx} cy={cy} r="4" fill="#0f172a" />
      <text x={cx + 6} y={cy + 18} className="fill-slate-700 text-[13px] font-bold">O</text>
      <text x={aPos.x} y={aPos.y} textAnchor="middle" className="fill-blue-700 text-[13px] font-bold">{labels[0]}</text>
      <text x={bPos.x} y={bPos.y} textAnchor="middle" className="fill-blue-700 text-[13px] font-bold">{labels[1]}</text>
      <text x={cPos.x} y={cPos.y} textAnchor="middle" className="fill-orange-700 text-[13px] font-bold">{labels[2]}</text>
      <text x={dPos.x} y={dPos.y} textAnchor="middle" className="fill-orange-700 text-[13px] font-bold">{labels[3]}</text>
    </svg>
  );
}

function normalizeBoardKind(value: unknown, fallback: number) {
  const num = Number(String(value || '').match(/30|45|60/)?.[0]);
  if (num === 30 || num === 60) return 30;
  if (num === 45) return 45;
  return fallback;
}

function parseList(value: unknown, fallback: string[]) {
  const parsed = String(value || '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function PatternVisual({ attrs }: any) {
  const rawSequence = String(attrs.sequence || '红,红,蓝,绿');
  if (/rect|overlap|paper|strip|重叠|长方形|纸条/i.test(rawSequence)) {
    return <OverlapRectVisual attrs={{ count: attrs.count || 5, length: attrs.length || 20, width: attrs.width || 10, overlap: attrs.overlap || 2 }} />;
  }

  const sequence = rawSequence.split(',').filter(Boolean).slice(0, 10);
  if (!sequence.every((name) => ['红', '蓝', '绿', '黄', '紫', '橙'].includes(name.trim()))) {
    return <p className="text-[13px] text-gray-500">该图形标记未通过规律图白名单校验，请重新生成练习或使用单题截图。</p>;
  }

  return (
    <svg className="h-24 w-full max-w-lg" viewBox="0 0 420 86" role="img" aria-label="规律序列图">
      {sequence.map((name, index) => {
        const cx = 28 + index * 38;
        return (
          <g key={`${name}-${index}`}>
            <circle cx={cx} cy="34" r="15" fill={colorValue(name)} stroke="#64748b" />
            <path d={`M ${cx} 49 L ${cx - 5} 66 L ${cx + 5} 66 Z`} fill="#fff" stroke="#94a3b8" />
            <text x={cx} y="39" textAnchor="middle" className="fill-white text-[11px] font-bold">{name}</text>
          </g>
        );
      })}
      <text x={30 + sequence.length * 38} y="40" className="fill-slate-400 text-[20px] font-bold">...</text>
    </svg>
  );
}

function TilePatternVisual({ attrs }: any) {
  const blackCounts = String(attrs.black || '4,6,8').split(',').map((item) => clampNumber(Number(item), 1, 40)).slice(0, 4);
  const rows = clampNumber(Number(attrs.rows || 2), 1, 5);
  const tile = 20;
  const gap = 2;
  const blockGap = 28;
  const maxCols = Math.max(...blackCounts.map((count) => Math.ceil(count / rows)), 3);
  const blockWidth = maxCols * (tile + gap) + 12;
  const viewWidth = Math.max(360, blackCounts.length * (blockWidth + blockGap) + 30);
  const viewHeight = rows * (tile + gap) + 64;

  return (
    <svg className="h-44 w-full max-w-3xl" viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label="黑白瓷砖规律图">
      {blackCounts.map((black, groupIndex) => {
        const x0 = 18 + groupIndex * (blockWidth + blockGap);
        const cols = Math.ceil(black / rows);
        return (
          <g key={groupIndex}>
            {Array.from({ length: rows * cols }, (_, index) => {
              const row = Math.floor(index / cols);
              const col = index % cols;
              const isBlack = index < black;
              return (
                <rect
                  key={index}
                  x={x0 + col * (tile + gap)}
                  y={22 + row * (tile + gap)}
                  width={tile}
                  height={tile}
                  fill={isBlack ? '#0f172a' : '#f8fafc'}
                  stroke="#64748b"
                />
              );
            })}
            <text x={x0 + (cols * (tile + gap)) / 2 - 4} y={viewHeight - 16} textAnchor="middle" className="fill-slate-700 text-[12px] font-bold">第{groupIndex + 1}个：{black}块黑砖</text>
          </g>
        );
      })}
      <text x={blackCounts.length * (blockWidth + blockGap) + 2} y="44" className="fill-slate-400 text-[22px] font-bold">...</text>
    </svg>
  );
}

function OverlapRectVisual({ attrs }: any) {
  const count = clampNumber(Number(attrs.count || 5), 2, 10);
  const length = clampNumber(Number(attrs.length || 20), 1, 999);
  const width = clampNumber(Number(attrs.width || 10), 1, 999);
  const overlap = clampNumber(Number(attrs.overlap || 2), 0, Math.max(0, length - 1));
  const rectWidth = 112;
  const rectHeight = Math.max(34, Math.min(70, rectWidth * (width / length)));
  const step = rectWidth * Math.max(0.18, (length - overlap) / length);
  const totalWidth = 28 + rectWidth + step * (count - 1) + 40;
  const viewWidth = Math.max(360, Math.min(720, totalWidth));
  const baseY = 40;

  return (
    <svg className="h-44 w-full max-w-3xl" viewBox={`0 0 ${viewWidth} 150`} role="img" aria-label="长方形纸条重叠图">
      {Array.from({ length: count }, (_, index) => {
        const x = 20 + index * step;
        return (
          <g key={index}>
            <rect x={x} y={baseY} width={rectWidth} height={rectHeight} rx="3" fill={index % 2 ? '#eff6ff' : '#dbeafe'} stroke="#64748b" strokeWidth="2" />
            <text x={x + rectWidth / 2} y={baseY + rectHeight / 2 + 5} textAnchor="middle" className="fill-slate-700 text-[12px] font-bold">第{index + 1}张</text>
          </g>
        );
      })}
      {count > 1 && overlap > 0 ? (
        <g>
          <line x1={20 + step} y1={baseY + rectHeight + 15} x2={20 + rectWidth} y2={baseY + rectHeight + 15} stroke="#2563eb" strokeWidth="2" markerStart="url(#arrow-left)" markerEnd="url(#arrow-right)" />
          <text x={20 + step + (rectWidth - step) / 2} y={baseY + rectHeight + 34} textAnchor="middle" className="fill-blue-700 text-[12px] font-bold">重叠 {overlap}</text>
        </g>
      ) : null}
      <line x1="20" y1={baseY - 14} x2={20 + rectWidth} y2={baseY - 14} stroke="#0f172a" strokeWidth="2" markerStart="url(#arrow-left)" markerEnd="url(#arrow-right)" />
      <text x={20 + rectWidth / 2} y={baseY - 22} textAnchor="middle" className="fill-slate-800 text-[12px] font-bold">长 {length}</text>
      <text x="20" y={baseY + rectHeight + 58} className="fill-slate-500 text-[12px]">共 {count} 张，每张宽 {width}</text>
      <defs>
        <marker id="arrow-left" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto">
          <path d="M8,0 L0,4 L8,8" fill="none" stroke="#2563eb" strokeWidth="1.5" />
        </marker>
        <marker id="arrow-right" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8" fill="none" stroke="#2563eb" strokeWidth="1.5" />
        </marker>
      </defs>
    </svg>
  );
}

function StackCupsVisual({ attrs }: any) {
  const count = clampNumber(Number(attrs.count || 5), 2, 10);
  const firstHeight = clampNumber(Number(attrs.first_height || attrs.firstHeight || 16), 1, 999);
  const step = clampNumber(Number(attrs.step || 3), 0.5, 999);
  const cupWidth = 54;
  const cupHeight = 44;
  const offset = 13;
  const x0 = 36;
  const y0 = 96;
  const totalHeight = firstHeight + (count - 1) * step;

  return (
    <svg className="h-44 w-full max-w-sm" viewBox="0 0 260 150" role="img" aria-label="杯子叠放图">
      {Array.from({ length: count }, (_, index) => {
        const y = y0 - index * offset;
        return (
          <g key={index}>
            <path d={`M ${x0} ${y} L ${x0 + cupWidth} ${y} L ${x0 + cupWidth - 9} ${y + cupHeight} L ${x0 + 9} ${y + cupHeight} Z`} fill="#dbeafe" stroke="#64748b" strokeWidth="2" />
            <ellipse cx={x0 + cupWidth / 2} cy={y} rx={cupWidth / 2} ry="8" fill="#eff6ff" stroke="#64748b" strokeWidth="2" />
          </g>
        );
      })}
      <line x1="122" y1={y0 - (count - 1) * offset - 8} x2="122" y2={y0 + cupHeight} stroke="#2563eb" strokeWidth="2" />
      <text x="136" y={y0 - (count - 1) * offset + 6} className="fill-blue-700 text-[12px] font-bold">约 {totalHeight} 高</text>
      <text x="36" y="136" className="fill-slate-500 text-[12px]">共 {count} 个杯子，每增加一个约增高 {step}</text>
    </svg>
  );
}

function RectPathVisual({ attrs }: any) {
  const width = clampNumber(Number(attrs.width || 15), 1, 999);
  const height = clampNumber(Number(attrs.height || 10), 1, 999);
  const path = String(attrs.path || 'A-D-C-B').replace(/[→>]/g, '-').split('-').filter(Boolean);
  const w = 220;
  const h = Math.max(90, Math.min(150, w * (height / width)));
  const x = 54;
  const y = 34;
  const points: Record<string, [number, number]> = {
    A: [x, y],
    B: [x + w, y],
    C: [x + w, y + h],
    D: [x, y + h],
  };
  const polyline = path.map((name) => points[name]?.join(',')).filter(Boolean).join(' ');

  return (
    <svg className="h-56 w-full max-w-xl" viewBox="0 0 360 210" role="img" aria-label="长方形路径图">
      <defs>
        <marker id="rect-path-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 Z" fill="#2563eb" />
        </marker>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill="#f8fafc" stroke="#64748b" strokeWidth="3" />
      {polyline ? <polyline points={polyline} fill="none" stroke="#2563eb" strokeWidth="4" markerEnd="url(#rect-path-arrow)" /> : null}
      {Object.entries(points).map(([name, [px, py]]) => (
        <g key={name}>
          <circle cx={px} cy={py} r="5" fill="#2563eb" />
          <text x={px + (name === 'A' || name === 'D' ? -24 : 12)} y={py + (name === 'A' || name === 'B' ? -10 : 22)} className="fill-slate-700 text-[14px] font-bold">{name}</text>
        </g>
      ))}
      <text x={x + w / 2} y={y - 12} textAnchor="middle" className="fill-slate-600 text-[12px]">AB={width}</text>
      <text x={x + w + 12} y={y + h / 2} className="fill-slate-600 text-[12px]">BC={height}</text>
      <text x={x} y={y + h + 46} className="fill-blue-700 text-[12px] font-bold">运动路径：{path.join('→')}</text>
    </svg>
  );
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function colorValue(name = '') {
  return ({
    红: '#ef4444',
    蓝: '#3b82f6',
    绿: '#22c55e',
    黄: '#f59e0b',
    紫: '#8b5cf6',
    橙: '#f97316',
  } as Record<string, string>)[name.trim()] || '#94a3b8';
}
