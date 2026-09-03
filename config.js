/* 接続・マスタ設定。GitHubには置くが、本番トークンは公開リポジトリに含めないこと。 */
window.APP_CONFIG = {
  // GASをデプロイして得られる Web App URL に差し替える
  GAS_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  // GAS側 SHARED_TOKEN と一致させる（試作用。公開リポジトリでは秘匿）
  TOKEN: 'CHANGE_ME_TOKEN',

  // 年代区分（GAS側 AGE_BUCKETS と一致させる）
  AGE_BUCKETS: ['0-2','3-6','7-12','13-18','19-39','40-64','65-74','75+'],
  // 障害区分（GAS側 DISABILITY_TYPES と一致させる）
  DISABILITY_TYPES: ['身体','知的','精神','発達','難病','その他'],

  // 市内地区マスタ（サンプル。本番の地区名に差し替える）
  DISTRICTS: ['中央','北','南','東','西','港'],

  // 備蓄品の初期テンプレ
  SUPPLY_TEMPLATE: [
    {item:'水', unit:'L'}, {item:'食料', unit:'食'}, {item:'毛布', unit:'枚'},
    {item:'簡易トイレ', unit:'回'}, {item:'マスク', unit:'枚'}, {item:'消毒液', unit:'本'}
  ]
};
