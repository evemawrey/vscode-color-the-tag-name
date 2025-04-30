import * as vscode from 'vscode';
import { TagInfo, colorMap, colorEntries } from './colors';
import { CommentSetting, commentSettingMap } from './commentSetting';

let tagInfos: TagInfo[] = [];

// 現在のテーマがライト系かを判定する関数
const isLightTheme = (): boolean => {
  const activeColorTheme = vscode.window.activeColorTheme.kind;
  const lightThemes = [1, 4];
  return lightThemes.includes(activeColorTheme);
};

const clearDecorations = () => {
  tagInfos.forEach((tagInfo) => {
    if (tagInfo.decChar && tagInfo.decChar.decorator) {
      tagInfo.decChar.decorator.dispose();
    }
  });
  tagInfos = [];
};

const decorateInner = (
  tagInfo: TagInfo,
  editor: vscode.TextEditor,
  src: string
) => {
  const commentSetting: CommentSetting =
    commentSettingMap[editor.document.languageId] || commentSettingMap.default;

  const config = vscode.workspace.getConfiguration('colorTheTagName');
  const onlyColorTagName = config.get('onlyColorTagName', false);

  if (tagInfo.decChar !== undefined) {
    tagInfo.decChar.decorator.dispose();
  }
  let regex: RegExp;
  if (onlyColorTagName) {
    regex = new RegExp(
      `${commentSetting.startRegExp || commentSetting.start}|${
        commentSetting.endRegExp || commentSetting.end
      }|<(\/?)${tagInfo.tagName}(?=\\s|\\/>|>|$)`,
      'gm'
    );
  } else {
    regex = new RegExp(
      `${commentSetting.startRegExp || commentSetting.start}|${
        commentSetting.endRegExp || commentSetting.end
      }|<(?:/|)${tagInfo.tagName}(?:$|(?:| (?:.*?)[^-?%$])(?<!=)>)`,
      'gm'
    );
  }
  let match: RegExpExecArray | null;
  let inComment = false;
  tagInfo.decChar = {
    chars: [],
    decorator: vscode.window.createTextEditorDecorationType({
      color: tagInfo.tagColor,
    }),
  };
  while ((match = regex.exec(src))) {
    // コメントだったら飛ばす
    // Skip if it's a comment
    if (match[0] === commentSetting.start) {
      // コメント開始
      // Comment starts
      inComment = true;
      continue;
    }
    if (match[0] === commentSetting.end) {
      // コメント終了
      // Comment ends
      inComment = false;
      continue;
    }
    if (inComment === true) {
      continue;
    }
    if (onlyColorTagName) {
      // Only color the tag name itself, not the brackets
      const slashLength = match[1] ? 1 : 0; // Length of the slash if present
      const startPos = editor.document.positionAt(
        match.index + 1 + slashLength
      ); // +1 for '<'
      const endPos = editor.document.positionAt(
        match.index + 1 + slashLength + tagInfo.tagName.length
      );
      const range = new vscode.Range(startPos, endPos);
      tagInfo.decChar.chars.push(range);
    } else {
      const splited = match[0].split(/[{}"]/);
      let singleLengths = 0;
      if (splited.length > 2) {
        splited.forEach(function (single, i) {
          // 偶数だったら
          if (i % 2 === 0 && match !== null && tagInfo.decChar !== undefined) {
            const startPos = editor.document.positionAt(
              match.index + singleLengths
            );
            const endPos = editor.document.positionAt(
              match.index + singleLengths + single.length
            );
            const range = new vscode.Range(startPos, endPos);
            tagInfo.decChar.chars.push(range);
          }
          singleLengths += single.length + 1;
        });
      } else {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(
          match.index + match[0].length
        );
        const range = new vscode.Range(startPos, endPos);
        tagInfo.decChar.chars.push(range);
      }
    }
  }
  editor.setDecorations(tagInfo.decChar.decorator, tagInfo.decChar.chars);
};

/**
 * Helper to select which part of the source file to search for tags to decorate.
 * @param {string} src - The source text to filter from.
 * @param {string} languageId - The language ID of the document.
 * @returns {string} - The text to be searched for tags to decorate.
 */
const selectSearchText = (src: string, languageId: string): string => {
  switch (languageId) {
    case 'vue': {
      // Vue support, currently does not consider jsx/tsx in <script> tags
      // Look for <template> tags and extract the content inside them
      const templateMatch = src.match(/<template>([\s\S]*?)<\/template>/);
      if (templateMatch) {
        return templateMatch[1];
      } else {
        // No template, nothing to decorate
        return '';
      }
    }
    default: {
      // For other languages, use the entire document text
      return src;
    }
  }
};

const decorate = () => {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return;
  }
  if (editor.document.fileName.endsWith('.ts')) {
    return;
  }

  const src = editor.document.getText();
  const searchText = selectSearchText(src, editor.document.languageId);
  if (searchText === '') {
    return; // No content to search for tags
  }
  const matches =
    searchText.match(
      /<(?:\/|)([a-zA-Z][a-zA-Z0-9.-]*)(?:$|(?:| (?:.*?)[^-?%$])(?<!=)>)/gm
    ) || [];
  const tagNameLikeWords = matches.map((word) =>
    word.replace(/[</>]|(?: .*$)/g, '')
  );
  const uniqueTagNames = [...new Set(tagNameLikeWords)];

  const themeType = isLightTheme() ? 'light' : 'dark'; // テーマの種類を取得
  uniqueTagNames.forEach((tagName) => {
    // まだないタグ名の分だけ追加。
    if (tagInfos.map(({ tagName }) => tagName).includes(tagName)) {
      return;
    }
    const tagColor =
      colorMap[themeType][tagName] ||
      colorEntries(themeType)[
        tagName.length + (tagName.match(/[aiueo]/g)?.length || 0)
      ][1];
    tagInfos.push({
      decChar: undefined,
      tagName,
      tagColor,
    });
  });
  tagInfos.forEach(function (tagInfo) {
    decorateInner(tagInfo, editor, src);
  });
};

export function activate(context: vscode.ExtensionContext) {
  // テーマ変更を監視
  vscode.window.onDidChangeActiveColorTheme(() => {
    clearDecorations(); // Clear existing decorations
    decorate(); // Reapply decorations with the new theme
  });

  // エディタが変更された時にトリガー
  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      decorate();
    },
    null,
    context.subscriptions
  );

  // ドキュメントが変更された時にトリガー
  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      decorate();
    },
    null,
    context.subscriptions
  );

  vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration('colorTheTagName')) {
        clearDecorations();
        decorate();
      }
    },
    null,
    context.subscriptions
  );

  decorate();
}

export function deactivate() {
  clearDecorations();
}
