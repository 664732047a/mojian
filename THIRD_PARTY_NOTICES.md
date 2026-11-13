# Third-party notices / 第三方开源声明

墨笺使用以下第三方开源软件。各组件的版权和许可继续由原作者持有；本项目的许可不替代这些第三方许可。安装包保留了相关原始声明、许可文件和资源文件中的署名。

## 编辑器与运行时

| 组件 | 已核对的许可 | 许可副本与来源 |
| --- | --- | --- |
| Vditor 3.11.3 | MIT | `Vditor-LICENSE.txt`，直接来自安装的 `vditor/LICENSE`；Copyright (c) 2019-present B3log 开源, b3log.org。分发脚本中的原始 2018-present 声明同时保留。 |
| Diff Match and Patch 1.0.5 | Apache License 2.0 | `diff-match-patch-LICENSE.txt`，来自安装的 `diff-match-patch/LICENSE`；Vditor 分发代码保留 Copyright 2018 The diff-match-patch Authors。 |
| Electron | MIT | `Electron-LICENSE.txt`，来自当前 Electron 分发；Copyright (c) Electron contributors；Copyright (c) 2013-2020 GitHub Inc. |
| Chromium 与 Electron 内嵌第三方组件 | 多种，逐组件列明 | `Electron-LICENSES.chromium.html`，为 Electron 随附的完整第三方声明。 |
| Lute | Mulan Permissive Software License, Version 2（木兰宽松许可证，第 2 版） | `Lute-LICENSE.txt`；来源记录于同目录 `Lute-SOURCE.txt`。 |
| KaTeX 0.16.9 | MIT | `KaTeX-LICENSE.txt`，取自对应 `v0.16.9` 上游版本；Copyright (c) 2013-2020 Khan Academy and other contributors。来源记录于 `KaTeX-SOURCE.txt`。 |

## 随 Vditor 离线分发的渲染资源

墨笺完整复制了所安装 Vditor 包的 `dist` 目录到 `dist/vditor/dist`，保留文件内的版权、许可注释，以及所有随附许可文件。完整资源包含当前界面未启用的可选渲染器。

| 组件 | 已核对的许可或分发声明 | 安装包内位置（相对于 `dist`） |
| --- | --- | --- |
| Highlight.js 11.7.0 | BSD 3-Clause；Copyright (c) 2006, Ivan Sagalaev | `vditor/dist/js/highlight.js/LICENSE` |
| Highlight.js 主题 | 以各主题文件头的独立声明为准，包括 MIT 与 CC BY-SA 4.0 等 | `vditor/dist/js/highlight.js/styles/`；全部原始文件与文件头保留。 |
| MathJax | Apache License 2.0 | `vditor/dist/js/mathjax/LICENSE` |
| WaveDrom 3.6.2 | MIT；Copyright (c) 2011-2026 Aliaksei Chapyzhenka | `vditor/dist/js/wavedrom/LICENSE.WaveDrom` |
| Mermaid | MIT；Copyright (c) 2014 - 2022 Knut Sveidqvist | `third-party/Mermaid-LICENSE.txt`；来源记录于 `Mermaid-SOURCE.txt`。分发文件末尾的嵌套组件声明原样保留，并另存为 `Mermaid-BUNDLED-NOTICES.txt`。 |
| Mermaid 内的 DOMPurify | 原始分发声明为 Apache License 2.0 与 Mozilla Public License 2.0 | `vditor/dist/js/mermaid/mermaid.min.js` 文件末尾的 bundled license information。 |
| Mermaid 内的 js-yaml、Lodash 和 Cytoscape 中的部分组件 | 原始分发注释注明 MIT；具体版权以文件原文为准 | 同上；`third-party/Mermaid-BUNDLED-NOTICES.txt`。 |
| abcjs 5.10.3 | MIT；Copyright (c) 2009-2019 Paul Rosen and Gregory Dyke | `third-party/abcjs-LICENSE.txt`，来自对应上游版本；原始分发头保留。 |
| D3 6.7.0（markmap 分发内） | BSD 3-Clause；Copyright 2010-2020 Mike Bostock | `third-party/D3-LICENSE.txt`，来自对应 `v6.7.0` 上游版本。 |
| markmap-lib 0.14.3、markmap-common 0.14.2 | 分发头明确注明 MIT | `vditor/dist/js/markmap/markmap.min.js` |
| ECharts | 分发头明确注明 Apache License 2.0；同一文件保留 Microsoft 组件的独立许可声明 | `vditor/dist/js/echarts/echarts.min.js` |
| Flowchart.js | 分发注释注明 MIT；Copyright (c) 2020 Adriano Raiano (adrai) | `vditor/dist/js/flowchart.js/flowchart.min.js` |
| Viz.js 2.1.2 | MIT；Copyright (c) 2014-2018 Michael Daines | `vditor/dist/js/graphviz/viz.js` 文件头；另存于 `third-party/Vizjs-BUNDLED-NOTICES.txt`。 |
| Graphviz 2.40.1（Viz.js 内嵌） | Viz.js 分发声明注明 Eclipse Public License v1.0 | 同上。项目来源：<http://www.graphviz.org>。 |
| Expat 2.2.5（Viz.js 内嵌） | Viz.js 分发声明注明 MIT | 同上；Copyright (c) 1998-2000 Thai Open Source Software Center Ltd and Clark Cooper；Copyright (c) 2001-2006 Expat maintainers。 |
| zlib（Viz.js 内嵌） | 原始分发指向 zlib 许可 | 同上；Copyright (C) 1995-2013 Jean-loup Gailly and Mark Adler；<https://www.zlib.net/zlib_license.html>。 |
| SmilesDrawer 内的 chroma.js | 分发内保留 BSD 3-Clause 原文；Copyright (c) 2011-2019 Gregor Aisch | `vditor/dist/js/smiles-drawer/smiles-drawer.min.js` |

PlantUML 编码器、SmilesDrawer 的其他模块、图标及其他可选资源也按 Vditor 原分发保留。上述表格仅对实际检查到的许可文件、分发头和上游许可进行索引，不把整个离线资源目录归为某一种许可。

## 许可文件位置

打包后，上述 `dist` 文件位于「墨笺.app」的 `Contents/Resources/app.asar` 内。此声明和集中整理的许可位于其中的 `dist/third-party/`；渲染器原始许可保留在相应的 `dist/vditor/dist/` 子目录中。

许可来源文件已包含在项目的 `build/third-party/` 内。构建和安装不需要联网获取这些许可。

墨笺未包含 Typora 的代码、商标图标或商业资源。
