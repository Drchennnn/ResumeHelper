# 离线地区数据来源

核验/取回日期：2026-10-23。数据随扩展分发，运行时只读取包内 `extension/data/regions.json`，不连接外部目录服务，也不新增 npm 运行时依赖。

## 固定版本与来源

- 上游：[`modood/Administrative-divisions-of-China`](https://github.com/modood/Administrative-divisions-of-China)。
- npm：[`china-division@2.7.0`](https://registry.npmjs.org/china-division/2.7.0)，2023-09-13 发布；2026-10-23 查询 registry 的 `dist-tags.latest` 仍为 `2.7.0`。这不代表行政区划截至 2026 年。
- 固定提交：`6fb5380de7e6c961869dcd1629df4adc088fa9bb`（npm `gitHead`）。
- 上游 [README](https://github.com/modood/Administrative-divisions-of-China/blob/6fb5380de7e6c961869dcd1629df4adc088fa9bb/README.md#数据来源) 声明大陆数据来自国家统计局 2023 年统计用区划代码，截止 2023-06-30，发布于 2023-09-11。
- 原始大陆三级树：[`dist/pca-code.json`](https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/6fb5380de7e6c961869dcd1629df4adc088fa9bb/dist/pca-code.json)，SHA-256 `83b7536f853ad16beb4d37b92890a3fd7bb9d33d4f37e7c8885fb948749a9bc4`。
- 原始港澳台补充：[`dist/HK-MO-TW.json`](https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/6fb5380de7e6c961869dcd1629df4adc088fa9bb/dist/HK-MO-TW.json)，SHA-256 `546616aa6ec7239d9bcf02cb063539652604162b1ab74ef65293537c54ea3534`。

## 覆盖范围与局限

大陆部分完整保留此版本三级树：31 个省级节点、342 个第二级节点、3,056 个第三级节点。节点包含上游统计用区划和开发区等记录，因此第三层节点数**不等同于法定县级行政区数量**。直辖市的“市辖区”等中间层也照录，不自行补造区县。

港澳台按上游补充文件原样保留名称及层级：香港 3 个分组 / 18 区，澳门 2 个分组 / 7 堂区，台湾 20 个市县 / 358 个下级名称。澳门分组是上游的地理/堂区目录，不代表现行行政层级。补充文件没有独立的资料日期或官方代码来源，不能宣称为当前完整行政名录；例如台湾文件没有金门县和连江县。最近的区划调整、目录缺项和名称差异均允许用户直接输入，以其实际地址/证件为准。

海外地区不在此目录中。界面应提供“海外/手动填写”，允许输入国家、地区和城市；不能把有限示例称为全球目录。港澳台同样允许手动填写，以覆盖缺项及其他习惯名称。

## 归一格式

```json
[{"code":"11","name":"北京市","children":[{"code":"1101","name":"市辖区","children":[{"code":"110101","name":"东城区","children":[]}]}]}]
```

- 大陆节点 `code`、`name` 和层级均来自原始三级树；只为叶节点补 `children: []`。
- 港澳台原始数据只有名称，归一化使用 `local:HK`、`local:MO`、`local:TW` 及按原文件顺序的子级序号作为**内部选择器标识**，例如 `local:HK:1:1`。这些不是官方行政区划编码，不得作为此类编码导出或提交；简历中保存地区名称。
- 未增加“海外”假行政区节点；海外/手动输入是界面模式。
- 共 34 个顶层节点、367 个第二级节点、3,439 个第三级节点。
- 当前产物 UTF-8 字节数：203573；SHA-256：`efc23ba25706263cf1da4c436d58837181f1200f8715565fb6fd1d6d8c57d09e`。

## 许可证

上游固定提交的实际 [LICENSE](https://github.com/modood/Administrative-divisions-of-China/blob/6fb5380de7e6c961869dcd1629df4adc088fa9bb/LICENSE) 为 WTFPL v2，允许复制、分发和修改，全文保留如下。npm `package.json`/registry 的 `license` 字段写作 `MIT`，与实际 LICENSE 和 README 徽章冲突；本项目按实际随源文件提供的 WTFPL v2 记录，**不将该数据宣称为 MIT**。本项目自己的许可证不改变该上游文件的许可证。上游声称原始资料源于国家统计局；本项目没有对上游原始政府数据授权作额外保证。

```text
        DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
                    Version 2, December 2004

 Copyright (C) 2004 Sam Hocevar <sam@hocevar.net>

 Everyone is permitted to copy and distribute verbatim or modified
 copies of this license document, and changing it is allowed as long
 as the name is changed.

            DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
   TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

  0. You just DO WHAT THE FUCK YOU WANT TO.
```

## 更新方式

固定新提交和版本后重新获取上述两个 JSON 文件，保留大陆原始树，为叶节点补空 `children`；按原补充文件顺序转换港澳台命名树并生成 `local:` 标识。核对节点数量、唯一标识、名称完整性和数据摘要后更新本说明。更新本地目录不应清除用户已保存的旧地区名称。
