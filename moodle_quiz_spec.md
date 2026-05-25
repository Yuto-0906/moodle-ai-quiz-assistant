# Moodle テストページ仕様書
## Chrome拡張機能実装用リファレンス

---

本ドキュメントは、Moodle 4.x（および 3.x との互換性備考）における Quiz 出題タイプの DOM 構造、入力要素の `name`/`id` パターン、JavaScript からの値取得・設定方法、そして AI 自動回答用の JSON フォーマットをまとめたものです。既に文書化されている `shortanswer` / `match` / `multichoice` / `essay` / `truefalse` を除く、全標準 / 主要サードパーティ Question Type を網羅します。

すべての Question Type に共通するルールとして:
- 各問題は `<div id="question-{usageid}-{slot}" class="que {qtype} ...">` でラップされます。`{qtype}` には `numerical`, `ddwtos`, `gapselect`, `ordering` 等の文字列が入ります。
- 入力要素の `name` / `id` は基本的に `q{usageid}:{slot}_{fieldname}` という形式で生成されます (`question_attempt::get_qt_field_name()` の出力)。`{usageid}` はクイズ受験単位を示す整数、`{slot}` は問題スロット番号 (整数) です。
- 値を JS から書き込む際は `input.value = ...` だけでなく `input.dispatchEvent(new Event('change', {bubbles:true}))` と `input.dispatchEvent(new Event('input', {bubbles:true}))` を必ず発火し、Moodle/YUI/AMD 側の更新ハンドラ (autosave、ddwtos JS 等) にも値変更を通知する必要があります。

---

## 1. ページ基本情報

| 項目 | 値 |
|---|---|
| URL パターン | `https://<moodle-host>/mod/quiz/attempt.php?attempt=XXXXX&cmid=XXXXX` |
| フォーム id | `responseform` |
| フォーム action | `https://<moodle-host>/mod/quiz/processattempt.php?cmid=XXXXX` |
| フォーム method | `POST` |
| ページタイプ | 全問が1ページに表示される（single-page）または複数ページの場合あり |

---

## 2. 問題コンテナの構造

各問題は `div.que` に格納される。

```html
<div id="question-{usageid}-{slot}" class="que {type} deferredfeedback notyetanswered">
  <!-- 問題テキスト -->
  <div class="qtext">...</div>
  <!-- 解答エリア -->
  <div class="ablock">...</div>
</div>
```

### ID・クラスの命名規則

- `id`: `question-{usageid}-{slot}`（例: `question-21642787-3`）
- `usageid`: そのテスト試行内の共通ID（全問同一）
- `slot`: 問題の順番ID（表示順と異なる場合あり）
- type クラス: `shortanswer` / `match` / `multichoice` / `truefalse` / `essay` など

---

## 3. 問題タイプ別・入力要素仕様

### タイプ①: `shortanswer`（短答式テキスト入力）

```html
<input type="text"
       name="q{usageid}:{slot}_answer"
       id="q{usageid}:{slot}_answer"
       class="form-control d-inline">
```

**例:** `name="q21642787:3_answer"`, `id="q21642787:3_answer"`

---

### タイプ②: `match`（マッチング＝ドロップダウン選択）

各サブ問題に `<select>` が1つずつ付く。

```html
<!-- 問題文テキストはtrの最初のtdに入る -->
<tr>
  <td class="text">問題文テキスト</td>
  <td>
    <select name="q{usageid}:{slot}_sub{N}"
            id="menuq{usageid}:{slot}_sub{N}"
            class="select custom-select ms-1">
      <option value="0">選択 ...</option>
      <option value="1">誤り</option>
      <option value="2">正しい</option>
    </select>
  </td>
</tr>
```

**例:** `name="q21642787:1_sub0"`, `name="q21642787:1_sub1"` …

> ※ 選択肢の value と text の対応はテストごとに異なる可能性があるため、  
> 実行時に `option` 要素を走査して動的に取得すること。

---

### タイプ③: `multichoice`（ラジオボタン選択肢）

```html
<input type="radio"
       name="q{usageid}:{slot}_answer"
       value="{N}"
       id="q{usageid}:{slot}_answer_{N}">
<label for="q{usageid}:{slot}_answer_{N}">選択肢テキスト</label>
```

---

### タイプ④: `essay`（記述式テキストエリア）

```html
<textarea name="q{usageid}:{slot}_answer"
          id="q{usageid}:{slot}_answer"
          class="form-control">
</textarea>
```

---

### タイプ⑥: `numerical`（数値入力）

`shortanswer` の派生で、UI はテキスト入力 1 個ですが、単位を別フィールドにする/ドロップダウンで選ぶ/末尾につけるなど 4 通りのレイアウトが存在します。

#### 基本形 (単位なし、または末尾文字)
```html
<div id="question-{usageid}-{slot}" class="que numerical ...">
  <span class="answer">
    <label class="sr-only" for="q{usageid}:{slot}_answer">Answer</label>
    <input type="text"
           name="q{usageid}:{slot}_answer"
           id="q{usageid}:{slot}_answer"
           size="14.5"
           class="form-control d-inline">
    <!-- 末尾単位表示の場合 -->
  </span>
</div>
```

#### 単位を別テキスト入力で受け取るレイアウト (`unitinput`)
```html
<input type="text" name="q{usageid}:{slot}_answer" id="q{usageid}:{slot}_answer" class="form-control d-inline">
<input type="text" name="q{usageid}:{slot}_unit"   id="q{usageid}:{slot}_unit"   class="form-control d-inline">
```

#### 単位をラジオボタンで選ばせるレイアウト (`unitradio`)
```html
<input type="radio" name="q{usageid}:{slot}_unit" id="q{usageid}:{slot}_unit_0" value="m">
<input type="radio" name="q{usageid}:{slot}_unit" id="q{usageid}:{slot}_unit_1" value="cm">
```

#### 単位をドロップダウンで選ばせるレイアウト (`unitselect`)
```html
<select name="q{usageid}:{slot}_unit" id="q{usageid}:{slot}_unit" class="custom-select">
  <option value="m">m</option>
  <option value="cm">cm</option>
</select>
```

#### JS による取得・設定
```javascript
const ans  = q.querySelector(`[name="q${usageid}:${slot}_answer"]`);
const unit = q.querySelector(`[name="q${usageid}:${slot}_unit"]`);
ans.value = "3.14";
ans.dispatchEvent(new Event('input',  {bubbles:true}));
ans.dispatchEvent(new Event('change', {bubbles:true}));
if (unit) {
  if (unit.tagName === 'SELECT' || unit.type === 'text') {
    unit.value = "m";
  } else if (unit.type === 'radio') {
    q.querySelectorAll(`[name="q${usageid}:${slot}_unit"]`).forEach(r => r.checked = (r.value === "m"));
  }
  unit.dispatchEvent(new Event('change', {bubbles:true}));
}
```

#### AI 用 JSON フォーマット
```json
{ "type": "numerical", "answer": "3.14", "unit": "m" }
```
単位が無いレイアウトでは `unit` を省略可。

---

### タイプ⑦: `calculated`（計算問題）

レンダラは `qtype_numerical` を継承し、HTML 構造はほぼ同一。違いは「問題文中のワイルドカード `{x}` が出題時に乱数置換される」点だけで、回答 UI 自体は数値 1 つ + 任意の単位フィールドです。

```html
<div id="question-{usageid}-{slot}" class="que calculated ...">
  <input type="text" name="q{usageid}:{slot}_answer" id="q{usageid}:{slot}_answer" class="form-control d-inline">
  <!-- 単位が有効な場合のみ -->
  <input type="text" name="q{usageid}:{slot}_unit"   id="q{usageid}:{slot}_unit"   class="form-control d-inline">
</div>
```

JS 操作・JSON フォーマットは `numerical` と同一。
```json
{ "type": "calculated", "answer": "12.5", "unit": "kg" }
```

---

### タイプ⑧: `calculatedsimple`（簡易計算）

`calculated` の機能制限版。DOM 構造・入力名・JSON 形式は `calculated` と完全に同一です。
```json
{ "type": "calculatedsimple", "answer": "42" }
```

---

### タイプ⑨: `calculatedmulti`（計算式付き多肢選択）

`multichoice` を継承。問題文に乱数ワイルドカードが入りますが、回答 UI は通常の多肢選択 (単一選択ならラジオ、複数選択ならチェックボックス)。

```html
<div id="question-{usageid}-{slot}" class="que calculatedmulti ...">
  <div class="answer">
    <div class="r0">
      <input type="radio"
             name="q{usageid}:{slot}_answer"
             id="q{usageid}:{slot}_answer0"
             value="0">
      <label for="q{usageid}:{slot}_answer0">a. 12.0 m/s</label>
    </div>
    <!-- ... 他の選択肢 ... -->
  </div>
</div>
```

複数選択 (`single = 0`) の場合はチェックボックスで `name="q{usageid}:{slot}_choice0"`, `_choice1` ... と個別フィールドになり、選ばれたものに `value="1"`、未選択なら送信されない `multichoice multi` と同じ仕様です。

#### JS による設定 (単一選択)
```javascript
q.querySelector(`[name="q${usageid}:${slot}_answer"][value="${idx}"]`).click();
```

#### JSON フォーマット
```json
{ "type": "calculatedmulti", "answer": 2 }
```
複数選択の場合:
```json
{ "type": "calculatedmulti", "answers": [0, 2] }
```

---

### タイプ⑩: `gapselect`（ドロップダウンによる単語穴埋め）

「問題文の `[[1]]`, `[[2]]` ... をドロップダウンに置換」する形式。Moodle 3.2 以降、コア標準。各「場所」(place) ごとに `<select>` が生成され、`name` は `q{usageid}:{slot}_p{place}` (place は 1 始まり) です。

```html
<div id="question-{usageid}-{slot}" class="que gapselect ...">
  <div class="qtext">
    The 
    <span class="control" data-place="1">
      <label class="sr-only" for="menuq{usageid}:{slot}_p1">Blank 1</label>
      <select id="menuq{usageid}:{slot}_p1"
              class="custom-select select menuq{usageid}:{slot}_p1"
              name="q{usageid}:{slot}_p1">
        <option value="0" selected></option>
        <option value="1">quick</option>
        <option value="2">slow</option>
      </select>
    </span>
    brown 
    <span class="control" data-place="2">
      <select name="q{usageid}:{slot}_p2" id="menuq{usageid}:{slot}_p2">
        <option value="0" selected></option>
        <option value="1">fox</option>
        <option value="2">cat</option>
      </select>
    </span>
    ...
  </div>
</div>
```

`<option value>` の値は **シャッフル後の選択肢インデックス (1 始まり)** です。`0` は未回答。

#### JS による取得・設定
```javascript
const selects = q.querySelectorAll('select[name^="q' + usageid + ':' + slot + '_p"]');
selects.forEach(sel => {
  const place = sel.name.match(/_p(\d+)$/)[1];
  // 表示テキストから値を逆引きするのが現実的
  const wantedText = aiAnswer["p" + place]; // 例: "quick"
  for (const opt of sel.options) {
    if (opt.text.trim() === wantedText) { sel.value = opt.value; break; }
  }
  sel.dispatchEvent(new Event('change', {bubbles:true}));
});
```

#### JSON フォーマット
AI には「各 place のキー → 選ばれるべき選択肢の表示テキスト」を返させるのが安全:
```json
{
  "type": "gapselect",
  "answers": { "p1": "quick", "p2": "fox", "p3": "lazy" }
}
```

---

### タイプ⑪: `ddwtos`（テキスト中ドラッグ＆ドロップ）

`gapselect` の派生で、ドロップ先の値は `<input type="hidden">` に格納されます。レンダラは `qtype_gapselect_base` を継承し、各 place ごとに hidden input + ドロップゾーン span + ドラッグ可能 span を出力します。

```html
<div id="question-{usageid}-{slot}" class="que ddwtos ...">
  <div class="qtext">
    The
    <span class="drop active group1 place1" tabindex="0"></span>
    brown
    <span class="drop active group1 place2" tabindex="0"></span>
    ...
    <!-- 各 place に対応する hidden input -->
    <input type="hidden"
           name="q{usageid}:{slot}_p1"
           id="q{usageid}:{slot}_p1"
           value="0"
           class="placeinput place1 group1">
    <input type="hidden" name="q{usageid}:{slot}_p2" id="q{usageid}:{slot}_p2" value="0"
           class="placeinput place2 group1">
  </div>

  <div class="answercontainer">
    <div class="draghomes">
      <span class="draghome group1 choice1" data-choice="1">quick</span>
      <span class="draghome group1 choice2" data-choice="2">slow</span>
      <span class="draghome group1 choice3" data-choice="3">lazy</span>
    </div>
  </div>
</div>
```

公式 JSDoc (`qtype_ddwtos/ddwtos`) より:
> "Each drag has a 'choice' number which is the value set on the drop's hidden input when this drag is placed in a drop."

つまり **回答の本体は `name="q{usageid}:{slot}_p{place}"` の hidden input** で、その `value` には選んだドラッグ要素の `data-choice` (1 始まりの整数、未配置は `0`) が入ります。

#### JS による設定 (UI のドラッグ動作を模倣せず、値だけ書き換える)
```javascript
function setDdwtos(q, usageid, slot, placeChoiceMap) {
  // placeChoiceMap: {1: 2, 2: 1, 3: 3}  place → choice 番号
  for (const [place, choice] of Object.entries(placeChoiceMap)) {
    const inp = q.querySelector(`input[name="q${usageid}:${slot}_p${place}"]`);
    if (!inp) continue;
    inp.value = String(choice);
    inp.dispatchEvent(new Event('change', {bubbles:true}));
  }
}
```
**注意**: 視覚上のドラッグ位置 (各 `.draghome` の表示位置) は反映されませんが、Moodle サーバ側は hidden input の値だけで採点するため、回答送信は正しく動作します。完全に UI を更新したい場合は `M.qtype_ddwtos` の YUI / AMD モジュールが提供する `placeDragInDrop` 等を呼び出す必要がありますが、自動回答用途では値書き換えで十分です。

#### `data-choice` の対応関係取得
ドラッグ要素の表示テキストから choice 番号を引きたい場合:
```javascript
const map = {};
q.querySelectorAll('.draghome[data-choice]').forEach(el => {
  map[el.textContent.trim()] = el.dataset.choice;
});
```

#### JSON フォーマット
AI には「place 番号 → 入れるべき語の表示テキスト」を返させ、上のテーブルで choice 番号に変換するのが堅牢です:
```json
{
  "type": "ddwtos",
  "answers": { "1": "quick", "2": "fox", "3": "lazy" }
}
```

---

### タイプ⑫: `ddimageortext`（画像へのドラッグ＆ドロップ）

背景画像上に複数のドロップゾーンがあり、テキストラベル / 画像を持つドラッグアイテムをドロップする形式。**回答の保存方法は `ddwtos` と同じく hidden input 群** ですが、`name` は drop 番号で、値は配置されたドラッグの choice 番号です。

```html
<div id="question-{usageid}-{slot}" class="que ddimageortext ...">
  <div class="droparea">
    <img class="dropbackground" src="...">
    <!-- ドロップゾーン (drop) -->
    <div class="dropzones"></div>
    <div class="dropzone group1 place1" style="left:120px; top:80px;"></div>
    <div class="dropzone group1 place2" style="left:200px; top:80px;"></div>
  </div>

  <div class="draghomes">
    <div class="draghome group1 choice1" data-choice="1">Apple</div>
    <div class="draghome group1 choice2" data-choice="2">Banana</div>
  </div>

  <input type="hidden" name="q{usageid}:{slot}_p1" id="q{usageid}:{slot}_p1" value="0" class="placeinput place1 group1">
  <input type="hidden" name="q{usageid}:{slot}_p2" id="q{usageid}:{slot}_p2" value="0" class="placeinput place2 group1">
</div>
```

JS 操作・JSON フォーマットは `ddwtos` と同一:
```json
{ "type": "ddimageortext", "answers": { "1": "Apple", "2": "Banana" } }
```

---

### タイプ⑬: `ddmarker`（マーカードラッグ＆ドロップ）

背景画像上に「マーカー」をドラッグして配置する形式。**他のドラッグ系と異なり、各ドラッグ要素ごとに 1 つの hidden input を持ち、値は `"x,y;x,y;..."` 形式の座標列** です (1 つのマーカーを複数地点に配置できるため)。

```html
<div id="question-{usageid}-{slot}" class="que ddmarker ...">
  <div class="droparea">
    <img class="dropbackground" src="...">
    <!-- マーカー位置決め用 -->
  </div>

  <div class="draghomes">
    <span class="marker choice1" data-choice="1">X</span>
    <span class="marker choice2" data-choice="2">Y</span>
  </div>

  <!-- 各 choice (= ドラッグ可能なマーカー種別) ごとに hidden input -->
  <input type="hidden" name="q{usageid}:{slot}_c1" id="q{usageid}:{slot}_c1" value="">
  <input type="hidden" name="q{usageid}:{slot}_c2" id="q{usageid}:{slot}_c2" value="">
</div>
```

`value` の形式 (例): `"123,45"` (マーカー1 個)、`"123,45;200,80"` (同じマーカーを 2 か所)。座標は背景画像のピクセル座標 (左上原点)。

#### JS による設定
```javascript
function setDdmarker(q, usageid, slot, choiceCoordMap) {
  // choiceCoordMap: {1: "100,50", 2: "300,200;320,210"}
  for (const [choice, coords] of Object.entries(choiceCoordMap)) {
    const inp = q.querySelector(`input[name="q${usageid}:${slot}_c${choice}"]`);
    if (!inp) continue;
    inp.value = coords;
    inp.dispatchEvent(new Event('change', {bubbles:true}));
  }
}
```

#### JSON フォーマット
```json
{
  "type": "ddmarker",
  "answers": { "1": "150,80", "2": "300,200;320,210" }
}
```

注意: 座標を AI に正しく当てさせるのは事実上困難なため、実用上は背景画像のサイズ (`<img class="dropbackground">` の `naturalWidth`/`naturalHeight`) と `data-choice` ラベル、各ドロップゾーン中心座標 (`window.qtype_ddmarker` ヘルパや `data-*` 属性から取得) を AI プロンプトに渡す前処理が必要です。

---

### タイプ⑭: `multianswer` (Cloze / 埋込み回答)

問題文中に `{1:SHORTANSWER:...}`, `{2:MULTICHOICE:...}` 等のサブ問題が埋め込まれる形式。各サブ問題の入力名には `_sub{i}_` プレフィックスが付与されます (公式 MoodleDocs より):

```
name="q{usageid}:{slot}_sub1_answer"     ← 短答式サブ問題
name="q{usageid}:{slot}_sub2_answer"     ← 多肢選択 (単一・インライン) サブ問題
```

```html
<div id="question-{usageid}-{slot}" class="que multianswer ...">
  <div class="qtext">
    Some text with
    <label>
      <input type="text"
             name="q{usageid}:{slot}_sub1_answer"
             id="q{usageid}:{slot}_sub1_answer"
             size="37"
             class="form-control d-inline">
    </label>
    and a multichoice embedded
    <select id="menuq{usageid}:{slot}_sub2_answer"
            class="select menuq{usageid}:{slot}_sub2_answer"
            name="q{usageid}:{slot}_sub2_answer">
      <option value=""></option>
      <option value="1">Correct answer</option>
      <option value="2">Wrong answer</option>
    </select>

    <!-- NUMERICAL サブ問題 -->
    <input type="text" name="q{usageid}:{slot}_sub3_answer" id="q{usageid}:{slot}_sub3_answer">

    <!-- MULTICHOICE 縦/横レイアウト (ラジオボタン) サブ問題 -->
    <input type="radio" name="q{usageid}:{slot}_sub4_answer" value="0" id="q{usageid}:{slot}_sub4_answer0">
    <input type="radio" name="q{usageid}:{slot}_sub4_answer" value="1" id="q{usageid}:{slot}_sub4_answer1">
  </div>
</div>
```

サブ問題の種別はインライン Multichoice では `<select>`、SHORTANSWER/NUMERICAL では `<input type="text">`、MULTICHOICE_V/MULTICHOICE_H ではラジオ群となります。

#### JS による設定
各サブ問題は単独 question type と同じ要領で `name="q{usageid}:{slot}_sub{i}_answer"` をターゲットに値設定:

```javascript
function setMultianswer(q, usageid, slot, subAnswers) {
  // subAnswers: {1: "Correct Answer", 2: "1", 3: "42", 4: "0"}
  for (const [i, val] of Object.entries(subAnswers)) {
    const els = q.querySelectorAll(`[name="q${usageid}:${slot}_sub${i}_answer"]`);
    if (els.length === 1) {
      els[0].value = val;
      els[0].dispatchEvent(new Event('change', {bubbles:true}));
    } else if (els.length > 1 && els[0].type === 'radio') {
      els.forEach(r => r.checked = (r.value === val));
      els[0].dispatchEvent(new Event('change', {bubbles:true}));
    }
  }
}
```

#### JSON フォーマット
```json
{
  "type": "multianswer",
  "answers": {
    "sub1": "Correct Answer",
    "sub2": "1",
    "sub3": "42"
  }
}
```
キーは `sub1` 〜 `subN`。値は当該サブ問題の native 形式 (短答式は文字列、ラジオ/select は選択肢 value)。

---

### タイプ⑮: `ordering`（順序並べ替え）

`gbateson/moodle-qtype_ordering` (コアではないがコミュニティ標準) のサードパーティ型。各アイテムを縦/横に並べ替えて回答する形式。**送信時の値は単一の hidden input にカンマ区切りでアイテム ID 列が入ります** (`response_{md5}` 形式)。

```html
<div id="question-{usageid}-{slot}" class="que ordering ...">
  <div class="ablock">
    <ul class="sortablelist vertical">
      <li class="sortableitem" id="ordering_item_0" data-itemid="abc123def">Item A</li>
      <li class="sortableitem" id="ordering_item_1" data-itemid="def456ghi">Item B</li>
      <li class="sortableitem" id="ordering_item_2" data-itemid="ghi789jkl">Item C</li>
    </ul>
    <!-- jQuery sortable がドラッグで順序を更新し、hidden input に書き戻す -->
    <input type="hidden"
           name="q{usageid}:{slot}_response_abcdef0123456789"
           id="id_q{usageid}:{slot}_response_abcdef0123456789"
           value="abc123def,def456ghi,ghi789jkl">
  </div>
</div>
```

hidden input の `name` 末尾は MD5 ハッシュ (各サイト/問題で固定)。値は `<li>` の `data-itemid` (またはアイテム md5) を**正しい順序**でカンマ連結したもの。

#### JS による設定
```javascript
function setOrdering(q, usageid, slot, orderedItemTexts) {
  const items = Array.from(q.querySelectorAll('li.sortableitem'));
  const textToId = {};
  items.forEach(li => textToId[li.textContent.trim()] = li.dataset.itemid || li.id);
  const idsInOrder = orderedItemTexts.map(t => textToId[t]).filter(Boolean);

  const hidden = q.querySelector('input[type="hidden"][name*="_response_"]');
  hidden.value = idsInOrder.join(',');
  hidden.dispatchEvent(new Event('change', {bubbles:true}));

  // 表示も並べ替え (任意)
  const ul = items[0].parentElement;
  idsInOrder.forEach(id => {
    const li = items.find(x => (x.dataset.itemid || x.id) === id);
    if (li) ul.appendChild(li);
  });
}
```

#### JSON フォーマット
```json
{
  "type": "ordering",
  "order": ["Item A", "Item C", "Item B"]
}
```

---

### タイプ⑯: `randomsamatch`（短答ランダムマッチング）

UI / DOM 構造は標準の `match`（マッチング）型と完全に同じ — 質問文左側列と、各行に右側ドロップダウンを持つテーブル構造。ランダム性はサーバ側で短答問題からサブ問題を選ぶだけで、レンダラはあくまで `qtype_match`/`qtype_ddmatch` 系のものと共通です。

```html
<div id="question-{usageid}-{slot}" class="que randomsamatch ...">
  <table class="answer">
    <tr class="r0">
      <td class="text">What is the capital of France?</td>
      <td class="control">
        <select name="q{usageid}:{slot}_sub0" id="menuq{usageid}:{slot}_sub0" class="custom-select">
          <option value="0" selected></option>
          <option value="1">Paris</option>
          <option value="2">Berlin</option>
          <option value="3">Madrid</option>
        </select>
      </td>
    </tr>
    <tr class="r1">
      <td class="text">What is the capital of Germany?</td>
      <td class="control">
        <select name="q{usageid}:{slot}_sub1" id="menuq{usageid}:{slot}_sub1">
          ...
        </select>
      </td>
    </tr>
  </table>
</div>
```

#### JS による設定
```javascript
function setRandomSamatch(q, usageid, slot, mapping) {
  // mapping: {0: "Paris", 1: "Berlin"} ← stem index → 表示テキスト
  for (const [i, ansText] of Object.entries(mapping)) {
    const sel = q.querySelector(`select[name="q${usageid}:${slot}_sub${i}"]`);
    if (!sel) continue;
    for (const opt of sel.options) {
      if (opt.text.trim() === ansText) { sel.value = opt.value; break; }
    }
    sel.dispatchEvent(new Event('change', {bubbles:true}));
  }
}
```

#### JSON フォーマット
```json
{
  "type": "randomsamatch",
  "answers": { "0": "Paris", "1": "Berlin" }
}
```

---

### タイプ⑰: `regexp`（正規表現短答）

サードパーティ拡張ですが UI は完全に `shortanswer` と同じ。1 つのテキスト入力のみ。

```html
<div id="question-{usageid}-{slot}" class="que regexp ...">
  <input type="text" name="q{usageid}:{slot}_answer" id="q{usageid}:{slot}_answer"
         class="form-control d-inline">
</div>
```

```javascript
const inp = q.querySelector(`[name="q${usageid}:${slot}_answer"]`);
inp.value = "AIの回答テキスト";
inp.dispatchEvent(new Event('change', {bubbles:true}));
```

```json
{ "type": "regexp", "answer": "AIの回答テキスト" }
```

---

### タイプ⑱: `pmatch`（パターンマッチ短答）

OU 製のサードパーティ拡張。基本構造は `shortanswer` ですが、1 行/複数行モード切替と sub/sup ボタン UI が付加される場合があります。中核入力は同一です。

```html
<div id="question-{usageid}-{slot}" class="que pmatch ...">
  <!-- シングルライン -->
  <input type="text" name="q{usageid}:{slot}_answer" id="q{usageid}:{slot}_answer"
         class="form-control d-inline">

  <!-- もしくは複数行モード -->
  <textarea name="q{usageid}:{slot}_answer" id="q{usageid}:{slot}_answer"
            rows="3" class="form-control"></textarea>
</div>
```

JS / JSON は `shortanswer` と同一:
```json
{ "type": "pmatch", "answer": "the cat sat on the mat" }
```

---

### タイプ⑲: `oumultiresponse`（OU 複数選択）

OU 製。UI は **チェックボックス型の標準 `multichoice`（multi-response）と完全同一**。違いは採点ルール (1/n スコア) のみで、DOM/HTML は同一です。テストコード (`get_contains_mc_checkbox_expectation('choice0', ...)`) からも確認できます。

```html
<div id="question-{usageid}-{slot}" class="que oumultiresponse ...">
  <div class="answer">
    <div class="r0">
      <input type="checkbox"
             name="q{usageid}:{slot}_choice0"
             id="q{usageid}:{slot}_choice0"
             value="1">
      <label for="q{usageid}:{slot}_choice0">a. Choice 1</label>
    </div>
    <div class="r1">
      <input type="checkbox" name="q{usageid}:{slot}_choice1" id="q{usageid}:{slot}_choice1" value="1">
      <label for="q{usageid}:{slot}_choice1">b. Choice 2</label>
    </div>
    ...
  </div>
</div>
```

各選択肢ごとに**個別の `name="q{usageid}:{slot}_choice{n}"`** チェックボックスがあり、選ばれたものは `value="1"` で送信、未選択は送信されない通常仕様。

#### JS による設定
```javascript
function setOumultiresponse(q, usageid, slot, selectedIdxArr) {
  q.querySelectorAll(`input[type="checkbox"][name^="q${usageid}:${slot}_choice"]`).forEach(cb => {
    const idx = parseInt(cb.name.match(/_choice(\d+)$/)[1]);
    cb.checked = selectedIdxArr.includes(idx);
    cb.dispatchEvent(new Event('change', {bubbles:true}));
  });
}
```

#### JSON フォーマット
```json
{ "type": "oumultiresponse", "answers": [0, 2, 3] }
```
配列値は選択肢の表示順 (シャッフル後) のインデックスです。

---

### タイプ⑳: `stack`（STACK 数学問題）

STACK 問題は問題文に `[[input:ans1]]`, `[[input:ans2]]` ... というプレースホルダを置き、各々が 1 つの入力フィールドとして展開されます。入力種別 (Algebraic / Numerical / Matrix / Textarea / Radio / Checkbox / Dropdown 等) は問題側で設定でき、出力 HTML が大きく変化します。

#### 標準 (Algebraic / Numerical) の場合
```html
<div id="question-{usageid}-{slot}" class="que stack ...">
  <div class="stackinputfeedback" id="q{usageid}:{slot}_ans1_val">
    <input type="text"
           name="q{usageid}:{slot}_ans1"
           id="q{usageid}:{slot}_ans1"
           value=""
           size="15"
           autocapitalize="none"
           spellcheck="false"
           class="algebraic">
    <input type="hidden"
           name="q{usageid}:{slot}_ans1_val"
           value="">
  </div>
</div>
```

`{usageid}:{slot}_ans1` がメイン入力。`_ans1_val` は STACK 内部の検証用シャドウフィールド (常時 AJAX で同期される) で、回答送信には**メイン入力の値だけで OK** (サーバ側が `_val` を受け取らなくても採点可能)。

#### Radio / Checkbox / Dropdown 入力の場合
```html
<input type="radio" name="q{usageid}:{slot}_ans1" value="1" id="q{usageid}:{slot}_ans1_1">
<select name="q{usageid}:{slot}_ans1" id="q{usageid}:{slot}_ans1">...</select>
```

#### Matrix 入力の場合
複数の `name="q{usageid}:{slot}_ans1_sub_0_0"`, `_ans1_sub_0_1` ... が生成されます。

#### JS による設定
```javascript
function setStack(q, usageid, slot, ansMap) {
  // ansMap: {ans1: "x^2+1", ans2: "[1,2,3]"}
  for (const [name, val] of Object.entries(ansMap)) {
    const inp = q.querySelector(`[name="q${usageid}:${slot}_${name}"]`);
    if (!inp) continue;
    inp.value = val;
    inp.dispatchEvent(new Event('input',  {bubbles:true}));
    inp.dispatchEvent(new Event('change', {bubbles:true}));
  }
  // STACK は AJAX バリデーションを走らせるが、送信には直接影響しない。
}
```

#### JSON フォーマット
```json
{
  "type": "stack",
  "answers": {
    "ans1": "x^2+2*x+1",
    "ans2": "5/3"
  }
}
```
STACK の構文は Maxima 形式 (例: `*` を必ず書く、`^` で累乗、`sqrt(x)`、`%pi`、`%e`)。AI には Maxima 互換の文字列を返すよう指示してください。

---

## 4. sequencecheck（整合性チェック用 hidden input）

各問題に必ず存在する。フォーム送信時に必要（変更不要）。

```html
<input type="hidden"
       name="q{usageid}:{slot}_:sequencecheck"
       value="1">
```

---

## 5. フォーム共通 hidden inputs

| name | 説明 |
|---|---|
| `attempt` | 試行ID（URLの attempt パラメータと同じ） |
| `thispage` | 現在のページ番号（0始まり） |
| `nextpage` | `-1`（最終確認/送信） |
| `timeup` | `0`（タイムアップフラグ） |
| `sesskey` | CSRFトークン（ページ読み込み時に取得必須） |
| `scrollpos` | スクロール位置（空文字でOK） |
| `slots` | 問題の slot 番号をカンマ区切りで列挙（例: `3,1,4,2`） |

---

## 6. 送信ボタン

```html
<!-- 「最終確認（解答一時保存）」= すべての解答を保存して確認ページへ遷移 -->
<input type="submit"
       name="next"
       id="mod_quiz-next-nav"
       value="最終確認（解答一時保存）">
```

---

## 7. 問題文・入力要素の取得方法（JavaScript）

```javascript
// ===== 全問題コンテナを取得 =====
const questions = document.querySelectorAll('.que');

questions.forEach(q => {
  // 問題タイプを取得
  const type = ['shortanswer','match','multichoice','truefalse','essay']
    .find(t => q.classList.contains(t));

  // usageid と slot を ID から取得
  const [, usageid, slot] = q.id.match(/question-(\d+)-(\d+)/);

  // 問題文テキスト
  const questionText = q.querySelector('.qtext')?.innerText?.trim();

  if (type === 'shortanswer' || type === 'essay') {
    // テキスト入力 / テキストエリア
    const input = q.querySelector(`[name="q${usageid}:${slot}_answer"]`);
    // → input.value = "AIの回答";

  } else if (type === 'match') {
    // マッチング（ドロップダウン）
    q.querySelectorAll('tr').forEach((row, i) => {
      const subText = row.querySelector('td:first-child')?.innerText?.trim();
      const select = row.querySelector('select'); // name: q{usageid}:{slot}_sub{i}
      // 選択肢一覧: Array.from(select.options).map(o => ({value:o.value, text:o.text}))
      // → select.value = "2"; // 例: "2" = 正しい
    });

  } else if (type === 'multichoice') {
    // ラジオボタン
    const radios = q.querySelectorAll(`input[name="q${usageid}:${slot}_answer"]`);
    // 各ラジオの選択肢テキスト: q.querySelector(`label[for="${radio.id}"]`).innerText
    // → targetRadio.checked = true;

  } else if (type === 'truefalse') {
    // True/False（ラジオボタンの特殊ケース）
    const radios = q.querySelectorAll(`input[name="q${usageid}:${slot}_answer"]`);
    // value: 1=True, 0=False のことが多い
  }
});
```

---

## 8. AIへ送るプロンプト構築とレスポンス形式

### プロンプト例

```
以下のMoodleテストの問題に答えてください。
必ず以下のJSON形式のみで返答してください（余分な文章は不要）。

{
  "answers": [
    {
      "slot": 3,
      "type": "shortanswer",
      "answer": "回答テキスト"
    },
    {
      "slot": 1,
      "type": "match",
      "subAnswers": [
        {"index": 0, "value": "2", "text": "正しい"},
        {"index": 1, "value": "1", "text": "誤り"}
      ]
    },
    {
      "slot": 2,
      "type": "multichoice",
      "answer": "3"
    }
  ]
}

【問題一覧】
[slot:3] 種類: shortanswer
問題文: ...

[slot:1] 種類: match
問題文: データリンク層に関する次の文は正しいか、誤りを含むかを解答しなさい。
選択肢: ["誤り", "正しい"]
サブ問題:
  0: データリンク層には、MAC副層が含まれることがある
  1: フロー制御とは、伝送誤りに対処するための機能である
  ...
```

---

## 9. Chrome拡張機能 実装仕様

### ファイル構成

```
moodle-ai-quiz/
├── manifest.json
├── content.js
├── popup.html
├── popup.js
└── icons/
    └── icon128.png
```

### manifest.json

```json
{
  "manifest_version": 3,
  "name": "Moodle AI Quiz Assistant",
  "version": "1.0.0",
  "description": "MoodleのテストページでAI（ChatGPT/Gemini）が自動的に解答するChrome拡張機能",
  "permissions": ["activeTab", "storage"],
  "host_permissions": [
    "http://*/mod/quiz/*",
    "https://*/mod/quiz/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "http://*/mod/quiz/attempt.php*",
        "https://*/mod/quiz/attempt.php*"
      ],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
```

### content.js の処理フロー

1. ページロード時、`.que` が存在するか確認
2. 全問題を走査してプロンプト文字列を構築
3. `chrome.storage.local` からAPIキーとモデル設定を取得
4. ChatGPT（OpenAI API）またはGemini APIへリクエスト送信（問題内に画像がある場合は画像も添付）
5. レスポンスのJSONをパースし、各フィールドに値をセット
6. 画面右下に「AIで解答」フローティングボタンを表示

### OpenAI API リクエスト

```javascript
const content = [
  { type: "text", text: prompt },
  ...images.flatMap(img => [
    { type: "text", text: `[slot:${img.slot} image:${img.index}]` },
    {
      type: "image_url",
      image_url: { url: img.dataUrl, detail: "auto" }
    }
  ])
];

const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [{ role: "user", content }],
    temperature: 0
  })
});
```

### Gemini API リクエスト

```javascript
const parts = [
  { text: prompt },
  ...images.flatMap(img => [
    { text: `[slot:${img.slot} image:${img.index}]` },
    {
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64
      }
    }
  ])
];

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0 }
    })
  }
);
```

---

## 10. 実際のテストで確認されたデータ（参考）

**テスト名:** 3章(前半)理解度確認テスト  
**usageid:** `21642787`  
**slots (hidden input):** `3,1,4,2`（表示順）

| 表示順 | slot | タイプ | 入力フィールド名 |
|---|---|---|---|
| 問題1 | 3 | shortanswer | `q21642787:3_answer` |
| 問題2 | 1 | match | `q21642787:1_sub0` 〜 `q21642787:1_sub3` |
| 問題3 | 4 | shortanswer | `q21642787:4_answer` |
| 問題4 | 2 | shortanswer | `q21642787:2_answer` |

> ⚠️ `usageid` と `slot` は試行・テストごとに変わるため、  
> 必ず動的に `.que` の `id` 属性から取得すること。

---

## 11. 注意事項

- **sesskey** はCSRFトークンのため、ページ読み込みのたびに変わる。フォームのhidden inputから取得すること: `document.querySelector('input[name="sesskey"]').value`
- **slots** hidden input はフォーム送信時に問題の順序を示す。変更不要。
- **sequencecheck** の値も変更不要（Moodle側が整合性チェックに使用）。
- 複数ページ構成のテストでは `nextpage` の値が `-1` 以外になる場合がある。
- Moodleのオートセーブ機能（`M.mod_quiz`）が定期的にフォームをPOSTするため、拡張機能側で値をセットした後はすぐに送信されることがある。

---

## まとめ表 — 入力 name 一覧

| QType | 主な input name パターン | 値の型 |
|---|---|---|
| numerical | `q{u}:{s}_answer`, `q{u}:{s}_unit` | 数値文字列 / 単位文字列 |
| calculated, calculatedsimple | `q{u}:{s}_answer`, `q{u}:{s}_unit` | 同上 |
| calculatedmulti | `q{u}:{s}_answer` (radio) または `q{u}:{s}_choice{n}` (checkbox) | 0 始まり index |
| gapselect | `q{u}:{s}_p{n}` (select) | 1 始まり choice 番号 |
| ddwtos, ddimageortext | `q{u}:{s}_p{n}` (hidden) | 1 始まり choice 番号 (`0` = 未配置) |
| ddmarker | `q{u}:{s}_c{n}` (hidden) | `"x,y;x,y"` 座標列 |
| multianswer | `q{u}:{s}_sub{i}_answer` ほか | サブ問題型による |
| ordering | `q{u}:{s}_response_{md5}` (hidden) | `"id1,id2,id3"` カンマ区切り |
| randomsamatch | `q{u}:{s}_sub{n}` (select) | 選択肢 value |
| regexp, pmatch | `q{u}:{s}_answer` | 自由テキスト |
| oumultiresponse | `q{u}:{s}_choice{n}` (checkbox) | `"1"` (チェック時) |
| stack | `q{u}:{s}_ans{n}` ほか各種 | 入力タイプによる |

---

## 共通 JavaScript ヘルパ (推奨実装)

```javascript
function fireInputAndChange(el) {
  el.dispatchEvent(new Event('input',  {bubbles:true}));
  el.dispatchEvent(new Event('change', {bubbles:true}));
}

function getQuestionUsageAndSlot(qDiv) {
  // qDiv = <div id="question-{usageid}-{slot}" class="que ...">
  const m = qDiv.id.match(/^question-(\d+)-(\d+)$/);
  return m ? { usageid: m[1], slot: m[2] } : null;
}

function detectQuestionType(qDiv) {
  return Array.from(qDiv.classList).find(c =>
    ['shortanswer','match','multichoice','essay','truefalse',
     'numerical','calculated','calculatedsimple','calculatedmulti',
     'gapselect','ddwtos','ddimageortext','ddmarker','multianswer',
     'ordering','randomsamatch','regexp','pmatch','oumultiresponse','stack'
    ].includes(c)
  );
}
```

---

## 互換性備考 (Moodle 3.x ↔ 4.x)

- `gapselect` / `ddwtos` / `ddimageortext` / `ddmarker` は Moodle 3.2 以降コア標準。3.0/3.1 ではプラグイン (qtype_ddwtos など) として別途インストールが必要でした。
- Moodle 4.0+ では Bootstrap 4/5 の `form-control` / `custom-select` クラスが標準。3.x では `form-control` の代わりに `select` クラスのみのサイトもあります。両対応するなら `select[name^="q{u}:{s}_"]` のように name 接頭辞で検索するのが安全です。
- `oumultiresponse`, `pmatch`, `regexp`, `ordering`, `stack` はいずれもサードパーティ製で、コアには含まれません。インストールされたバージョンによって細かなクラス名 (例: `sortablelist` vs `ordering_list`) が異なる可能性があるため、name 接頭辞ベースの検索を推奨します。
- Moodle 4.x で `id` 属性に `:` が含まれる点に注意 (`q123:5_answer`)。`querySelector` で使う際は属性セレクタ `[id="q123:5_answer"]` の形式が必要です (`#q123:5_answer` は CSS セレクタ的に無効)。

---

## AI 用統一 JSON プロンプト例

すべての question type を 1 つのスキーマに集約する場合の推奨フォーマット:

```json
{
  "questions": [
    {
      "slot": 1,
      "type": "numerical",
      "answer": "9.81",
      "unit": "m/s^2"
    },
    {
      "slot": 2,
      "type": "gapselect",
      "answers": { "p1": "noun", "p2": "verb" }
    },
    {
      "slot": 3,
      "type": "ddwtos",
      "answers": { "1": "Paris", "2": "France" }
    },
    {
      "slot": 4,
      "type": "ordering",
      "order": ["Step 1", "Step 2", "Step 3"]
    },
    {
      "slot": 5,
      "type": "multianswer",
      "answers": { "sub1": "42", "sub2": "1" }
    },
    {
      "slot": 6,
      "type": "stack",
      "answers": { "ans1": "x^2+1" }
    }
  ]
}
```

拡張機能側ではこの JSON を受け取り、各 `slot` に対応する `<div id="question-{usageid}-{slot}">` を取得 → `detectQuestionType()` → 上記タイプ別ハンドラに分岐、というディスパッチで全 question type を統一的に扱えます。

---

## 注意事項・実装上のヒント

1. **autosave 対応**: Moodle 4.x のクイズには `mod_quiz/autosave` AMD モジュールがあり、入力後 60 秒で自動下書き保存します。`change` イベントが発火していれば自動保存も動作するため、明示的な保存呼び出しは通常不要です。
2. **`{usageid}` と `{slot}` の取得**: `<form action="processattempt.php">` 内に `<input name="thisattempt" value="...">` があり、また各 `<div class="que ...">` の `id` 属性が `question-{usageid}-{slot}` となっています。
3. **読み取り専用 (review) 状態**: 採点後のレビューページでは入力が `readonly`/`disabled` 化されます。Chrome 拡張で値を書き込んでも送信されないため、回答ページ (`attempt.php`) のみで動作させること。
4. **STACK と ddmarker の限界**: STACK は構文の正確性、ddmarker は座標の正確性が AI に強く要求されるため、自動回答の精度が他の type に比べて落ちます。フォールバックや警告表示を実装することを推奨します。
5. **本仕様書のサードパーティ系 (`ordering`, `regexp`, `pmatch`, `oumultiresponse`, `stack`) は、各プラグインのリポジトリ (gbateson, moodleou, maths/moodle-qtype_stack 等) から推定した一般的な構造です**。サイトによってカスタマイズされている可能性があるため、実装前に対象 Moodle インスタンスの実際の HTML を `view-source:` で確認することを強く推奨します。
