export const visualTemplateDefinitions = [
  {
    kind: "clock",
    label: "钟面题",
    drawable: true,
    example: "[图:clock hour=5 minute=0 angle=150]",
    recognitionGuide: "钟面题写 visualType=clock，描述时针分针位置。",
    generationGuide: "钟面题",
    matchPattern: "钟面|分针|时整|点钟|钟表|时针.*分针|分针.*时针"
  },
  {
    kind: "triangle_board",
    label: "简单三角板或角度题",
    drawable: true,
    example: "[图:triangle_board angles=75,135,150]",
    recognitionGuide: "简单三角板角度题可写 visualType=triangle_board；复杂拼接、多个角标或依赖原图相对位置时不要使用该模板。",
    generationGuide: "简单三角板或角度题",
    matchPattern: "三角板|拼角"
  },
  {
    kind: "triangle_board_composition",
    label: "三角板组合角题",
    drawable: true,
    example: "[图:triangle_board_composition angles=105 relations=60+45 labels=1]",
    recognitionGuide: "单一明确三角板组合角题可写 visualType=triangle_board_composition，例如 ∠1 由 60° 和 45° 拼成；同一复杂图中包含 ∠1、∠2、∠3 等多个角标时不要使用该模板，应写 visualType=geometry/other，visualComplexity=complex_image，visualRenderStrategy=source_crop，supportedTemplate=none。",
    generationGuide: "单一三角板组合角题",
    matchPattern: "90\\s*[+＋]\\s*45|60\\s*[+＋]\\s*45|45\\s*[-－]\\s*30"
  },
  {
    kind: "triangle_board_overlap",
    label: "两块三角板共顶点重叠题",
    drawable: true,
    example: "[图:triangle_board_overlap aod=150 labels=A,B,C,D kind1=45 kind2=30]",
    recognitionGuide: "两块直角三角板的直角顶点重合摆放、出现 ∠AOB=90°、∠COD=90°、∠AOD 或 ∠BOC 等四字母角时写 visualType=triangle_board_overlap；aod 取题干给出的 ∠AOD（90~180 之间的整数），若题干只给 ∠BOC 则 aod=180-∠BOC；labels 用题干里实际出现的四个字母（默认 A,B,C,D，对应外左/内左/内右/外右）；kind1/kind2 为两块三角板的非直角锐角（45 或 30，默认 45 和 30）。",
    generationGuide: "两块三角板共直角顶点重叠角题",
    matchPattern: "三角板.*(?:直角顶点|顶点)\\s*(?:重合|重叠|共点|重叠在一起)|(?:直角顶点|顶点)\\s*(?:重合|重叠).*三角板|∠\\s*[A-Z]O[A-Z]\\s*[=＝]\\s*\\d+\\s*°.*∠\\s*[A-Z]O[A-Z]"
  },
  {
    kind: "pattern",
    label: "颜色/图形规律题",
    drawable: true,
    example: "[图:pattern sequence=红,红,蓝,绿]",
    recognitionGuide: "气球/颜色排列题写 visualType=pattern，描述颜色序列。",
    generationGuide: "颜色/图形规律题",
    matchPattern: "规律|序列|气球|颜色|排列|第\\s*\\d+\\s*个|红|蓝|绿|黄|紫|橙"
  },
  {
    kind: "tile_pattern",
    label: "黑白瓷砖/方块规律题",
    drawable: true,
    example: "[图:tile_pattern black=4,6,8 rows=2]",
    recognitionGuide: "黑白瓷砖/方块规律写 visualType=tile_pattern。",
    generationGuide: "黑白瓷砖/方块规律题",
    matchPattern: "黑白|黑砖|白砖|瓷砖|方块|方格|正方形|矩形地面"
  },
  {
    kind: "overlap_rect",
    label: "长方形纸条重叠题",
    drawable: true,
    example: "[图:overlap_rect count=5 length=20 width=10 overlap=2]",
    recognitionGuide: "长方形纸条重叠题写 visualType=overlap_rect，并输出 count、length、width、overlap。",
    generationGuide: "长方形纸条重叠题",
    matchPattern: "纸条|纸带|长方形纸|矩形纸|重叠|重合|粘贴|首尾相接"
  },
  {
    kind: "stack_cups",
    label: "杯子叠放高度题",
    drawable: true,
    example: "[图:stack_cups count=5 first_height=16 step=3]",
    recognitionGuide: "杯子叠放题写 visualType=stack_cups，并输出 count、first_height、step。",
    generationGuide: "杯子叠放高度题",
    matchPattern: "杯子.*(?:叠起来|叠放|摞起来|高度)|(?:叠起来|叠放|摞起来|高度).*杯子"
  },
  {
    kind: "rect_path",
    label: "长方形路径运动题",
    drawable: true,
    example: "[图:rect_path width=15 height=10 path=A-D-C-B]",
    recognitionGuide: "长方形路径运动题写 visualType=rect_path，并输出 width、height、path。",
    generationGuide: "长方形路径运动题",
    matchPattern: "长方形.*ABCD|ABCD.*长方形|点P|沿.*边|路径|A\\s*[→>-]\\s*D|逆时针"
  }
];

export const sourceImageTemplate = {
  kind: "source_image",
  label: "复杂原图题",
  drawable: false,
  example: "[图:source_image url=/output/uploads/example.png]",
  generationGuide: "复杂原图题"
};

export const visualTemplateKinds = visualTemplateDefinitions.map((template) => template.kind);
export const drawableVisualKinds = visualTemplateDefinitions
  .filter((template) => template.drawable)
  .map((template) => template.kind);
export const supportedVisualKinds = [...drawableVisualKinds, sourceImageTemplate.kind];

export function isDrawableVisualKind(kind = "") {
  return drawableVisualKinds.includes(String(kind || "").toLowerCase());
}

export function isSupportedVisualKind(kind = "") {
  return supportedVisualKinds.includes(String(kind || "").toLowerCase());
}

export function visualTypeValueList() {
  return ["none", ...visualTemplateKinds, "geometry", "other"].join("/");
}

export function supportedTemplateValueList() {
  return [...drawableVisualKinds, "none"].join("/");
}

export function visualMarkerExamples(options = {}) {
  const includeSourceImage = Boolean(options.includeSourceImage);
  const examples = visualTemplateDefinitions.map((template) => template.example);
  if (includeSourceImage) examples.push(sourceImageTemplate.example);
  return examples;
}

export function visualMarkerExampleText(options = {}) {
  const examples = visualMarkerExamples(options);
  if (examples.length <= 1) return examples.join("");
  return `${examples.slice(0, -1).join("、")} 或 ${examples.at(-1)}`;
}

export function visualRecognitionGuideText() {
  return visualTemplateDefinitions
    .map((template) => template.recognitionGuide)
    .filter(Boolean)
    .join("；");
}

export function visualGenerationGuideLines(options = {}) {
  const includeSourceImage = Boolean(options.includeSourceImage);
  const templates = includeSourceImage ? [...visualTemplateDefinitions, sourceImageTemplate] : visualTemplateDefinitions;
  return templates.map((template) => `  - ${template.generationGuide || template.label}： ${template.example}`);
}

export function visualTemplateByKind(kind = "") {
  return visualTemplateDefinitions.find((template) => template.kind === String(kind || "").toLowerCase()) || null;
}

export function visualKindMatchesRegistry(kind = "", source = "") {
  const template = visualTemplateByKind(kind);
  if (!template?.matchPattern) return false;
  return new RegExp(template.matchPattern).test(String(source || ""));
}
