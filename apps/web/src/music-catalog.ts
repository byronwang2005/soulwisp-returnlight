import type {GameView} from '@wangxu/shared';

export const MUSIC={
  welcome:{title:'余灯未眠',mood:'竖琴 · 暖金弦乐'},
  camp:{title:'织絮的市集',mood:'木管 · 拨弦'},
  craft:{title:'记忆的织机',mood:'钟琴 · 流动琶音'},
  research:{title:'银絮的秘闻',mood:'空灵钟声 · 深蓝和声'},
  rooms:{title:'召灯的信号',mood:'远钟 · 低声脉动'},
  lobby:{title:'同行的脚步',mood:'拨弦 · 行进节奏'},
  tutorial:{title:'艾琳的记忆',mood:'音乐盒 · 柔和弦乐'},
  engineering:{title:'点灯之手',mood:'木琴 · 温暖律动'},
  combat:{title:'石城试炼',mood:'低鼓 · 紧张弦乐'},
  prep:{title:'最后的暖光',mood:'铜管 · 集结鼓点'},
  explore:{title:'灰月石城',mood:'暗色弦乐 · 潜行脉动'},
  discuss:{title:'灯下的证词',mood:'稀疏琴音 · 静谧和声'},
  vote:{title:'悬而未决',mood:'时钟 · 悬疑低音'},
  draft:{title:'编织余灯',mood:'星光钟琴 · 上行旋律'},
  extract:{title:'归途终钟',mood:'疾行鼓点 · 归灯主题'},
  victory:{title:'灯火归来',mood:'明亮弦乐 · 凯旋钟声'},
  defeat:{title:'月蚀之后',mood:'低音弦乐 · 余烬琴音'},
  connecting:{title:'远处的回声',mood:'回声 · 雾中灯声'},
  auth:{title:'留下归灯之名',mood:'钢琴 · 记忆主题'}
} as const;
export type MusicScene=keyof typeof MUSIC;
export function phaseMusic(view:Pick<GameView,'phase'|'result'|'self'>):MusicScene {
  if(view.phase==='RESULT')return view.result?.winner!=='invalid'&&view.result?.winner===view.self.faction?'victory':'defeat';
  return ({LOBBY:'lobby',PREP:'prep',EXPLORE:'explore',DISCUSS:'discuss',VOTE:'vote',DRAFT:'draft',EXTRACT:'extract'} as const)[view.phase];
}
export const tutorialMusic:MusicScene[]=['tutorial','engineering','combat','discuss','draft','extract'];
