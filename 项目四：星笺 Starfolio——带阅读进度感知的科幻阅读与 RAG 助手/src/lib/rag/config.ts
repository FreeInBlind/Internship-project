import 'server-only';

const legacyNamespace = 'starfolio-corpus-5401056d489d8b68efcf-64e2a8a1';

export const corpus = {
  namespace: legacyNamespace,
  index: 'starfolio-cohere-v1', model: 'embed-multilingual-v3.0', dimensions: 1024,
  chunker: 'body-block-v1', preprocessing: 'exact-block-text-v1', field: 'Dense',
};

import { namespacesForMappings, namespaceForVersion, type NamespaceMapping } from './namespace-registry';

const namespaceMappings: NamespaceMapping[] = [
  ...['sf-trans-2026-01-knock', 'sf-trans-2026-01-semiosis-upper', 'sf-trans-2026-03-semiosis-lower',
    'sf-trans-2026-01-last-stronghold', 'sf-trans-2026-01-frederick-brown-essay', 'sf-trans-2026-01-call-of-the-wild-review']
    .map((issueWorkKey) => ({ issueWorkKey, contentVersion: '*', namespace: legacyNamespace })),
];

namespaceMappings.push(
  {
    issueWorkKey: 'sf-trans-2025-01-extra-halo-editorial-introduction',
    contentVersion: 'fd49e298a0945583c8ae1ed5c87da66be7e889f70447e168832d8158569276ee',
    namespace: 'starfolio-corpus-3b6f37cca8685eae5d72-c63df3af',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-extra-love-editorial-introduction',
    contentVersion: 'ef243a3590bf172740079027465d2a0e799f613507df79f77c19a8d34a6b0047',
    namespace: 'starfolio-corpus-4461c3f6d79f277e418e-cd3e5a22',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-extra-efficiency-editorial-and-author-note',
    contentVersion: '411008db537259b89344c30387cc88a83615aecd38d464fc31fea457ab973cf6',
    namespace: 'starfolio-corpus-4ef92cff0fea53270829-813160e2',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-extra-silence-editorial-introduction',
    contentVersion: '57759b4439cf9dcfa1aea08bbde59ab1c29f4aabf36d3bbe46c5eb546c84bda8',
    namespace: 'starfolio-corpus-28297f290a7e61fc0973-81df68eb',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-extra-fools-editorial-introduction',
    contentVersion: '757dd6c7b6ea29a53a233d817e48c6bd96b7f25dbb253e0adb3a8e9746cf58b3',
    namespace: 'starfolio-corpus-fa66d391d0d79b67590e-9902608f',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-extra-fools-author-profile',
    contentVersion: 'aa30e96f86cffa669d608293647eea76f6fb16e921cd319f667591bd7a1598ac',
    namespace: 'starfolio-corpus-61b8b1a0a24053597226-b9ef58e0',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-fools-upper',
    contentVersion: '2dce8c12a0d2aee6902790973d836b1603210dae2a631cdd0bf7f68ae036de0a',
    namespace: 'starfolio-corpus-ed64e8aef27fa240c4ee-8d5528ba',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-silence-before-i-sleep',
    contentVersion: 'cc3d20c8fa26476c46d1ae330e332dd02353216a7c4b1810fa72c96bb43aa539',
    namespace: 'starfolio-corpus-faee04982ef07f2ec966-641e7d17',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-reality-mirror',
    contentVersion: '55b7b209ff80d8aa351d83f58e48191dd065db73f985b75e92e800ce5ece537c',
    namespace: 'starfolio-corpus-1360620c0b39fddd046b-fd92c015',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-halo-of-angels',
    contentVersion: 'cf2c1897b9dae9f4c3512f31e2569212d139ab683a0ee37904bbf58973c5cc48',
    namespace: 'starfolio-corpus-df72a09f3acd35361186-a961a81b',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-love-like-bruises',
    contentVersion: '092c1c9f8fce4ea6d24e063812c3a15ef9f2ab556bf1d11c1d77f5dbdd952c55',
    namespace: 'starfolio-corpus-9e4e5d3ff30d0671100f-70342a56',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-efficiency',
    contentVersion: 'e651da7a2245464814ef8565e81a8f163b2918638b6197c3b4caf3d64f168030',
    namespace: 'starfolio-corpus-1bd209d5367f9a5dbc26-2781b297',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-sales-picking-up-at-last',
    contentVersion: 'fd325d37271e49ad14a02366490bbe9ad141d55368ea9d17082bb9f7eb6914a5',
    namespace: 'starfolio-corpus-c4d80d5115f073aafaab-58a207b6',
  },
  {
    issueWorkKey: 'sf-trans-2025-01-utopie-27',
    contentVersion: 'f4d2169692f7277bad0c3a18dfe6b9fa91d52e7835a602e43508d05dffaf491e',
    namespace: 'starfolio-corpus-e7d49a0f0f482be55745-0c7d7c95',
  },
  {
    issueWorkKey: 'sf-trans-2026-02-dog-people',
    contentVersion: '52fe98093b950b30f09fe84e0c9ac0903f8cbf9055e8b7816d4496981c3a981a',
    namespace: 'starfolio-corpus-91033521e9b382327db7-566b0e02',
  },
  {
    issueWorkKey: 'sf-trans-2026-04-folded-bookstore',
    contentVersion: 'a75993d962bf34e00fd466ae60eddfced169066873e0e4b31eae4c820fa856cc',
    namespace: 'starfolio-corpus-792bd5c90d5e7485ffbb-11350dd6',
  },
  {
    issueWorkKey: 'sf-trans-2026-04-heartbreak-hotel-pluto',
    contentVersion: 'af2233412380cd28a2cde812326d568f9d90f89add4c7bd571e8c7378524dfa6',
    namespace: 'starfolio-corpus-9af5042d808e9dfdd0dc-9e4f0c54',
  },
  {
    issueWorkKey: 'sf-trans-2026-03-almond-pirates',
    contentVersion: 'e7d2dceba41ed61d46ef0a5b55da248385f2bc4ec3522dd59a6a7d4247661075',
    namespace: 'starfolio-corpus-7934240207e8354c44d1-bdf6700b',
  },
  {
    issueWorkKey: 'sf-trans-2026-02-four-horsemen',
    contentVersion: 'fcd371b394e97ef0dca8c8cea9e7436e281b41a6e96affb0de2e66118b4a2ad3',
    namespace: 'starfolio-corpus-ba142b46c7c1dc6dd0e0-ac82c212',
  },
  {
    issueWorkKey: 'sf-trans-2026-02-house-of-open-wounds-middle',
    contentVersion: 'a51f5fe12935b3779ca804f3365c771636e7fed542d24402e2bc21956fcf6827',
    namespace: 'starfolio-corpus-a71421198d67514530b6-cc78b9b5',
  },
  {
    issueWorkKey: 'sf-trans-2026-02-nirvana',
    contentVersion: '06bf914987fa29435ba512a2010649b713ef373591690bbf6bfb1a3b6a30cba6',
    namespace: 'starfolio-corpus-c961bb13d870fa7f5235-233a84dd',
  },
  {
    issueWorkKey: 'sf-trans-2026-03-smart-box-man',
    contentVersion: '8c715423d63ac5105f8dfd65fc91c87e5c35de6bcd718704924375281d7b11b3',
    namespace: 'starfolio-corpus-1585e7fca75e3746f658-dae8dc0a',
  },
  {
    issueWorkKey: 'sf-trans-2026-04-homecoming-sublimation',
    contentVersion: '39f8ea77c2ea4caa1d7b5de1c606c1b3a1afa470c355e45cde73ec83852d3583',
    namespace: 'starfolio-corpus-bfdbe482613f562e11ac-ae4dc933',
  },
  {
    issueWorkKey: 'sf-trans-2026-04-fioha-dubhan',
    contentVersion: '4047b6fbde6895ddf31ab58d1194ef6fbc51eb6ac9324cc55e954d4372256d47',
    namespace: 'starfolio-corpus-c38416ee965e06056ec2-916e6f4e',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-unfinished-architectures',
    contentVersion: '2902f148f9883b01a6b9577a09cbe7bf002935a75ba5f8b71eb69dd7730f09dd',
    namespace: 'starfolio-corpus-fc309537ffc203d4144a-974e123e',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-imaginative-youngster-ufos',
    contentVersion: '8ae3dea4fd7a65eab027cf44b8c9c6ca6231eee81763b483e2fb26783d87b979',
    namespace: 'starfolio-corpus-9a2dfebdd0880d8f5ce8-03aa795f',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-teleporting-disaster-fairy',
    contentVersion: '9c87628952b455f0a05b345c64d0acee8425f2e9d8e6d31a8333a4cee9c6fd39',
    namespace: 'starfolio-corpus-e2e77da1bc217ad67345-b5053e72',
  },
  {
    issueWorkKey: 'sf-trans-2026-01-secret-enemy',
    contentVersion: '2c264075a96d2e49d7214c5205af5b8968cb749e9b994fdfd7efcb649dfa501f',
    namespace: 'starfolio-corpus-a250d816c90b33fc1ecb-2a95dc28',
  },
  {
    issueWorkKey: 'sf-trans-2026-01-chatbots-said-love',
    contentVersion: '758cac4d125d33a9994ce4f9097ea8294bf4e8808e245cd6c64fec4a0a3505ba',
    namespace: 'starfolio-corpus-819854b188b46f96fbb3-a456400b',
  },
  {
    issueWorkKey: 'sf-trans-2026-01-quantum-fish',
    contentVersion: '11567c03d421201d0488feefec2b99a5a7c201e8fbbda39ed53075b86c9fa4c5',
    namespace: 'starfolio-corpus-4497d558b39b053cd58f-2d416c08',
  },
  {
    issueWorkKey: 'sf-trans-2026-01-natura-poem',
    contentVersion: '27bb040a6a6eb4ef636cc086b6db7b0d2281ce057930840a2ac7e767206c1df4',
    namespace: 'starfolio-corpus-3d65511a20f1fea1f8f6-d21b2e00',
  },
  {
    issueWorkKey: 'sf-trans-2026-03-unlai',
    contentVersion: '2e82eefc97cfe799ba905ec3786a208ae0519e186985ffa152b2e7d7cfc369d9',
    namespace: 'starfolio-corpus-6beb799e1149ad413789-a3d4fb19',
  },
  {
    issueWorkKey: 'sf-trans-2026-03-walk-to-full-moon',
    contentVersion: '187e2b9b125e1701d22cd6365a1ad03b3c03cfc7b6c0e9f5acbe52fe0436667c',
    namespace: 'starfolio-corpus-2309e83a3cf3e1e9fca1-c112405b',
  },
  {
    issueWorkKey: 'sf-trans-2026-03-ode-to-newton',
    contentVersion: 'e992159cf57eeb6315482710f5f9e8aa440c0857eec4d5cc65a58837a5813d01',
    namespace: 'starfolio-corpus-4744f9629b5f8425334a-6e2ea31d',
  },
  {
    issueWorkKey: 'sf-trans-2026-03-holli',
    contentVersion: 'c6f56aad88e8a250b39cc12328794e6433ba358ad36a91c4c67be9eaad864ac8',
    namespace: 'starfolio-corpus-f6edca5b44f10161c08b-130a7973',
  },
  {
    issueWorkKey: 'sf-trans-2026-03-semiosis-lower-full',
    contentVersion: 'f9ebb8ebf3c9ccc2d6160af101c7d0a4124cf6a25253b73d0d097c674320e975',
    namespace: 'starfolio-corpus-4c5ab57158aecd2f83f9-2187c26b',
  },
  {
    issueWorkKey: 'sf-trans-2026-03-freemium',
    contentVersion: '5d7309b3904dd520a6a26225aeac9f10aa218fba0136eef9d4581715e20b4396',
    namespace: 'starfolio-corpus-fa3211e143e311fca78a-5f17eee7',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-caruth-correct',
    contentVersion: '9be07f47c138cd41f763d8bd0e56c33e15eb67990814e6565d4d28bf752f3c8d',
    namespace: 'starfolio-corpus-506aa2fe82b1886bb4a6-93ce792a',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-gods',
    contentVersion: '7ec4f6fbe88402dc42de4e2aaf8bfb624ef3e74f82c0cbf8d1a802731df898f5',
    namespace: 'starfolio-corpus-a79295bf04d45d7a7d97-ab5bb973',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-one-step-away',
    contentVersion: '32166622fc5517a77428f0376b8a6b431c0f4193c277549c42c2909e5d4d36f7',
    namespace: 'starfolio-corpus-5ce7a81d2aa30e117442-37fa3bfa',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-golden-helix',
    contentVersion: '37e5c0973f2e85a61867d56cab4d8759efa489a92fe55c4cb2f43f5e17059c91',
    namespace: 'starfolio-corpus-73e99e517b26b5007172-d9f71da9',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-temple-of-nature',
    contentVersion: '97313af4de97c5c5e7261aac6c9291d147ca1db4288b47fa4d8fd50b8967f80d',
    namespace: 'starfolio-corpus-779c4d13901a9d11d5f4-03793b89',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-try-translation-followup',
    contentVersion: '551a26e8a31b7136b676dd510c655894194d6b554488c1e79fc290d0cd35f495',
    namespace: 'starfolio-corpus-e4953deb3e82a3fc8b2b-200032ed',
  },
  {
    issueWorkKey: 'sf-trans-2026-04-house-of-open-wounds-late',
    contentVersion: '5db43acc1ad672d02b8af06bd153aa080b0eefd77fa315b806a2aa66c61b9b48',
    namespace: 'starfolio-corpus-5fb7d0ac189c6f1999dd-1bc75fdb',
  },
  {
    issueWorkKey: 'sf-trans-2026-04-violet-thistlewaite-upper',
    contentVersion: '8ad67d851abdf6f44b6d26d77ad761b941cec4b0686e759e13b940b909ce43ab',
    namespace: 'starfolio-corpus-574b306c8e900156e3ef-abc93b6c',
  },
  {
    issueWorkKey: 'sf-trans-2026-05-who-moved-my-moon-upper',
    contentVersion: '885e8ab8f64f12ab7fa9a1711edb4dd2c0b8f99da7e47f88cb508e3f77a74dae',
    namespace: 'starfolio-corpus-eb27e0a217411c29ea70-20a1538b',
  },
);

namespaceMappings.push(
  { issueWorkKey: 'sf-trans-2025-02-in-bludd', contentVersion: '7fdbb6da60ebba27dc75c7cab13372c7c29f4156f9beb466cb254e59a40b30d1', namespace: 'starfolio-corpus-3afa6b7434dade300994-9806b142' },
  { issueWorkKey: 'sf-trans-2025-02-in-bludd-editorial-intro', contentVersion: '841d9787703d325cfc96b82f601273bca38999c455acdb8f3b7c55ec201795cf', namespace: 'starfolio-corpus-47f0f8155e5a666966ab-00960d6b' },
  { issueWorkKey: 'sf-trans-2025-02-madeleine', contentVersion: 'b63be1fb000425f9861da77d7b25a1b067e369daba05a8e6decda3937e89a95a', namespace: 'starfolio-corpus-045867a73e7d75a30903-78169177' },
  { issueWorkKey: 'sf-trans-2025-02-madeleine-editorial-intro', contentVersion: '443b1eb61603cdafabc52691b5e4befbcdcb133a5bf6f214729de34aef36d8c7', namespace: 'starfolio-corpus-f5dc51bcaa073fb71141-77a41755' },
  { issueWorkKey: 'sf-trans-2025-02-return-summerland', contentVersion: '604d2fb7cb31d48efd8ec181ddcd80a405cfdb2091058b2950bd41a4bc262710', namespace: 'starfolio-corpus-99c9b51b2074174858e5-a644f643' },
  { issueWorkKey: 'sf-trans-2025-02-return-summerland-editorial-intro', contentVersion: '695f7312aff08aa29b96073c3a9c0ece1958758e0122475b882d1e06bee2cc41', namespace: 'starfolio-corpus-67a2028d853f1249726f-f9194be2' },
  { issueWorkKey: 'sf-trans-2025-02-shoddy-lands', contentVersion: 'c90a2e7b037075ab080024a98cb295ac2acdddf9f1e038f153985de759cfd551', namespace: 'starfolio-corpus-032388df08686298a5ac-98520540' },
  { issueWorkKey: 'sf-trans-2025-02-witch-king-lower', contentVersion: '07afe3d1ba9299b36c752459f47a19ddfa5f0a6b4f1ac0b9e2ac70c34973720f', namespace: 'starfolio-corpus-1aa45c58c6fe9f019849-d0ed578d' },
  { issueWorkKey: 'sf-trans-2025-03-barbarians', contentVersion: '6f54fc25321ee418a0a43134a0a109a78e9e452b7d9c21551931ea376da132eb', namespace: 'starfolio-corpus-6c9e0ebfbca09827384d-6524558c' },
  { issueWorkKey: 'sf-trans-2025-03-best-last-only', contentVersion: 'fbb1594e4ccec9f3c75587af7e40b608e7ee3d1062ae0c02a9c41bab60d9b48c', namespace: 'starfolio-corpus-a5d5fc3473699a9869ff-1a9c6f64' },
  { issueWorkKey: 'sf-trans-2025-03-extra-barbarians-introduction', contentVersion: '045bd5f45408548395153cad368c942fe88425107d69e5a905bf5c65172f4006', namespace: 'starfolio-corpus-839d54df186c62ea603c-2192cccc' },
  { issueWorkKey: 'sf-trans-2025-03-extra-best-last-only-introduction', contentVersion: '68f92c6cc54e3c6fae1e90b682de3d18f5741d1213aa55a58593136609aa82a7', namespace: 'starfolio-corpus-ffd597cd27bebab77780-15743dae' },
  { issueWorkKey: 'sf-trans-2025-03-extra-rage-introduction', contentVersion: 'fe149300d13b68555630b125c73f8b70257d1a019f8d3409eef0b454d48166af', namespace: 'starfolio-corpus-e583e18eee6c505c3d80-ea2e24e6' },
  { issueWorkKey: 'sf-trans-2025-03-fool-commentary', contentVersion: '760edee06e7cd14fbedad3ff9c8192231c3c908e20ad178da24c45d2c29480fc', namespace: 'starfolio-corpus-4c394509103f8193e768-6cf6160c' },
  { issueWorkKey: 'sf-trans-2025-03-fools-lower', contentVersion: 'ff8aaf31235418dd48a247a7b7d68126f4f3b2884c7e943326a963aa37c8a8dd', namespace: 'starfolio-corpus-ce0444a8007c201e640c-0f75158d' },
  { issueWorkKey: 'sf-trans-2025-03-rage-not-mad', contentVersion: '82d9a5e3ba5c16a878b4c5f619a93b7c369ce673450dcff8125a660cd8f377ee', namespace: 'starfolio-corpus-ccf7378d63003667cb07-441823cf' },
  { issueWorkKey: 'sf-trans-2025-04-deep-roots', contentVersion: 'c388d5ce77d26326aff91b37c54b2f549832e0d23d757a162130047943bb3f9c', namespace: 'starfolio-corpus-114e0c613d793350c8f6-380ec668' },
  { issueWorkKey: 'sf-trans-2025-04-extra-deep-roots-introduction', contentVersion: 'c9fac5e95c3c3531fd29af4e2ea297491e05bb4e76636de13f81e9b74eee5c45', namespace: 'starfolio-corpus-b2360eeb7dacf371bf06-fa08097e' },
  { issueWorkKey: 'sf-trans-2025-04-extra-parthenogenesis-author-profile', contentVersion: 'd9c5d20ce9c210c1a981e6926c8e56073aa562660a74d3c035a48b879fd92240', namespace: 'starfolio-corpus-fb8f454c0a83a649e270-da3693f2' },
  { issueWorkKey: 'sf-trans-2025-04-extra-parthenogenesis-synopsis', contentVersion: '8cb2fdb73a64e094e84162983af02f91b28d1d33b628d0307fc4be099949e65c', namespace: 'starfolio-corpus-fa0933bb533d5c57aa44-cdfc9d26' },
  { issueWorkKey: 'sf-trans-2025-04-extra-resurrection-introduction', contentVersion: '4879473b954e80b5930ccecfb67610ac8f1f6f45eaccc04f8687cadd6f74bc1e', namespace: 'starfolio-corpus-1eb1eb4ef86bd06e3c84-5ef54972' },
  { issueWorkKey: 'sf-trans-2025-04-extra-white-powder-introduction', contentVersion: '7e0516942b34d3230ff321d3135746d6d9b39a81147f159397a56ab493ba570e', namespace: 'starfolio-corpus-c9d24796009b1636bfcf-b9b11438' },
  { issueWorkKey: 'sf-trans-2025-04-parthenogenesis', contentVersion: '462bc3a71ca62682ec3cb45b8a9f504f12f88a56153bc897b360b3b6f7fee4bd', namespace: 'starfolio-corpus-cc7d5b8db8d58b64ddbc-e1ce76b3' },
  { issueWorkKey: 'sf-trans-2025-04-partial-god-omniscient-messenger', contentVersion: '74848c846374145e942e386f085bd8e5bae2103c258a9bd5551e28c57d07367a', namespace: 'starfolio-corpus-dbd1f750e440881ecf5d-9bbb8f5b' },
  { issueWorkKey: 'sf-trans-2025-04-pattern-upper', contentVersion: '1a73f6cf1d25de5572b2c4aaf26e5eec4f7c7ae362746d5ef7f82348072bb27c', namespace: 'starfolio-corpus-6027a24d5e5ac27545ef-24a96e1e' },
  { issueWorkKey: 'sf-trans-2025-04-resurrection', contentVersion: 'cbb310ee3f70177697c3bce337daf0f4cc75dca88ca4330513606d237a9180f9', namespace: 'starfolio-corpus-1ad48562bfa2b20434ab-ac875e6f' },
  { issueWorkKey: 'sf-trans-2025-04-white-powder', contentVersion: '123c6d222e49ee54381059df75b7e2cdafaba4b6f18180fc1bf647fb1b8f98b8', namespace: 'starfolio-corpus-48bf87932e2188f1cf8d-ff85ead2' },
  { issueWorkKey: 'sf-trans-2025-05-electrica', contentVersion: '9cb30ae6f8cd5dfb70e6206122c1c731227e72ca41d0e0ac78b50e9874367692', namespace: 'starfolio-corpus-8eef6dbf3965364f25e6-0086d1b2' },
  { issueWorkKey: 'sf-trans-2025-05-extra-electrica-introduction', contentVersion: '1d1bb63c5caed0d03fd6c0550dda506bb703e25ea3822dd6a413a3dae548d3a3', namespace: 'starfolio-corpus-9966c30863fa3e1825f6-be601042' },
  { issueWorkKey: 'sf-trans-2025-05-extra-secret-language-birds-introduction', contentVersion: 'a68a867c7d410a4f5e9be3d20cf4aea35bb374c861c0af6602908698cbe1f9ed', namespace: 'starfolio-corpus-c3a4c499915b79a0f5bc-f031787e' },
  { issueWorkKey: 'sf-trans-2025-05-extra-service-model-upper-introduction', contentVersion: '67a326b99aa137fb44ed035aa3c2486c4142b603e9cbd2194dd9ce4b3ac1ac75', namespace: 'starfolio-corpus-7a017a81505bcea69790-d530e64e' },
  { issueWorkKey: 'sf-trans-2025-05-extra-seventh-expression-introduction', contentVersion: 'f4ec274740453382a79ac4e3cc49343ae0f9102b3eab315e71bf8e77b9d0c32f', namespace: 'starfolio-corpus-53ab6ffe97369220c28e-bba378a0' },
  { issueWorkKey: 'sf-trans-2025-05-extra-spider-crab-dyke-introduction', contentVersion: '9353f5aadc30dfa2763ac36c36906fa6ca1cab2a6a8edd2e1f9368650cf497ee', namespace: 'starfolio-corpus-14b3407e818e90830740-cfcd3c51' },
  { issueWorkKey: 'sf-trans-2025-05-extra-teach-you-read-introduction', contentVersion: '4d0dbd49516c3a8368ddd3973ea1c603bf9d85567a03e9a63d99d4f6e12dfedd', namespace: 'starfolio-corpus-b277159fe6b0ba5b3546-0cbc09b1' },
  { issueWorkKey: 'sf-trans-2025-05-secret-language-birds', contentVersion: 'd07b490a9d51155d15e6e8ffea848426a909ee193c94d3908e9d3ad47876aff7', namespace: 'starfolio-corpus-9c5651b7e95bc63175b3-50cff585' },
  { issueWorkKey: 'sf-trans-2025-05-service-model-upper', contentVersion: '7c1083a65ad1d55c1e5437baaadda3b91cc6945038367cee141ba84a65001baf', namespace: 'starfolio-corpus-ba1b99903266173d3274-b9ab125e' },
  { issueWorkKey: 'sf-trans-2025-05-seventh-expression', contentVersion: '5f2f83bda28a4f1abb9dc9ab8e058fcfee9a60e77882070a6a642aff9f0a885e', namespace: 'starfolio-corpus-aeeb3b82ea09af751e5e-011be931' },
  { issueWorkKey: 'sf-trans-2025-05-spider-crab-dyke', contentVersion: '4be7ddd444a3ebcf3e1655eff0aae20a8c132ee5b4218787ce8c15412535cda5', namespace: 'starfolio-corpus-508ba2bb9c6cc0786e66-7d94b0fa' },
  { issueWorkKey: 'sf-trans-2025-05-teach-you-read', contentVersion: 'e63122cb2f139d0974f53d9024b00f0060aa04d977b0642147242a7385591468', namespace: 'starfolio-corpus-d952f0a6ae58ab6cab73-caa2fff1' },
  { issueWorkKey: 'sf-trans-2025-06-child-river', contentVersion: 'fd64ecd1f799b99561323ca256d3720102d89f29abcd04d15290e7290df2e5b1', namespace: 'starfolio-corpus-21a59df6d0b35bf16e33-7b298ac3' },
  { issueWorkKey: 'sf-trans-2025-06-domestic-god', contentVersion: 'b4154345b12186156bf0a0e0186e17761ac8787693351ab1a8abe0605b4e7266', namespace: 'starfolio-corpus-01a7ac797fc362adf2e0-1e3b2bb2' },
  { issueWorkKey: 'sf-trans-2025-06-encore', contentVersion: '6b48bd52d7e0954f9ccd66fd0bb25f9b1ce5530da3139eaa698c2c7197b7130f', namespace: 'starfolio-corpus-6cf6e1764b7944673926-6db69fd3' },
  { issueWorkKey: 'sf-trans-2025-06-extra-child-river-introduction', contentVersion: 'b2e1683e150ffbf6ad8502c9de708e721e3c474fc5d61a7ae17e33f241814115', namespace: 'starfolio-corpus-989a4c92bcf722b9e47e-7ad62ce4' },
  { issueWorkKey: 'sf-trans-2025-06-extra-domestic-god-introduction', contentVersion: 'c1f687a0527decba9d9238ab4631c5a53f90c5432fd122f818a84b2aff428b98', namespace: 'starfolio-corpus-6838cecd783966788adf-376b7e55' },
  { issueWorkKey: 'sf-trans-2025-06-extra-encore-introduction', contentVersion: '445f430ca84e04a8ac475134fc195437fd6e2ed8c1c09de0247be39ba4ef6ba5', namespace: 'starfolio-corpus-2070340474485be19e1d-38ada059' },
  { issueWorkKey: 'sf-trans-2025-06-extra-five-views-tartarus-introduction', contentVersion: '860f620a15fc312c4c43b15b34b40a5e7eb5a8a13b6a32b0e50966363cf8e0ff', namespace: 'starfolio-corpus-ea46603e1232698d52f8-2c333f00' },
  { issueWorkKey: 'sf-trans-2025-06-extra-meat-introduction', contentVersion: 'be73b507af63e13a93a0a9f7c3bb9efedd6d04ad4523a33b8d3fe3efaf4cfce1', namespace: 'starfolio-corpus-2cbb6d1eb9e248a90da4-13483375' },
  { issueWorkKey: 'sf-trans-2025-06-five-views-tartarus', contentVersion: '78a97b848aaad91c7e2952fcd4df62aa15a1b2083eeeeb723d0935bfe0f73122', namespace: 'starfolio-corpus-facbc2478903041521a8-33b03638' },
  { issueWorkKey: 'sf-trans-2025-06-meat', contentVersion: '07b369959871401d59e9a5c9e3d754e767fe32522b6644a7726b52736fce3ea3', namespace: 'starfolio-corpus-047353d73fb3d21605e2-62440a30' },
  { issueWorkKey: 'sf-trans-2025-06-pattern-lower', contentVersion: 'ad44d3ffbc48e073a9f499d4e1414c110a37de0f10c4d0f72c890b43058e47d4', namespace: 'starfolio-corpus-6cd753211135d7533ef4-6e941435' },
  { issueWorkKey: 'sf-trans-2025-08-bound-ghosts-and-death', contentVersion: '59bc7a76a07a007dd1c53724e03c51840afb2c34dd4c2d0c994deafe655f9e94', namespace: 'starfolio-corpus-bf96ecd42efe63b21e1f-28de65ae' },
  { issueWorkKey: 'sf-trans-2025-08-extra-bound-ghosts-host-introduction', contentVersion: '9cdf8a0fa7ec766ceca85e18e2b62585005bde35acc884042f83f4d876b5d4ce', namespace: 'starfolio-corpus-8fb8c548a7a4a8da37e7-b507c240' },
  { issueWorkKey: 'sf-trans-2025-08-extra-hair-grows-introduction', contentVersion: 'f2e98f966679a7d216bfff8229177f25b88cf8681c016b96c7bd144454be8efb', namespace: 'starfolio-corpus-7b1ca9ccab9767677b55-46307da8' },
  { issueWorkKey: 'sf-trans-2025-08-extra-ling-hun-introduction', contentVersion: '2e84afe3480bcf427d9f23052e323c1b813018f65bfd41359298d1f1a6a2c0e8', namespace: 'starfolio-corpus-d144ebecb03c8632c3cf-ed1e0a61' },
  { issueWorkKey: 'sf-trans-2025-08-extra-remembered-salt-introduction', contentVersion: '9b8895bc896344ef334bfe14ad6cbbd0298a94ddbf5d169bdae33cf1195cc6f1', namespace: 'starfolio-corpus-10b0165479725c57f1f1-557cd128' },
  { issueWorkKey: 'sf-trans-2025-08-extra-tainted-cup-upper-introduction', contentVersion: '0840f3257dd2f802edac2f8ddf6ecae867586b8417f50e7a90804a31d201c785', namespace: 'starfolio-corpus-92c6784608efb61d11db-fd0e750e' },
  { issueWorkKey: 'sf-trans-2025-08-extra-witch-worlds-end-introduction', contentVersion: 'dbc154ba4614df29bac82fe48f5db5ce5d716ce8c4928750b440d64d1c9b3fc4', namespace: 'starfolio-corpus-41107c3c3523327dc9fc-1e90fc22' },
  { issueWorkKey: 'sf-trans-2025-08-hair-grows', contentVersion: '3383a78c363fce03246b29f13dfa58db63f7b201a19d2d740a181d79391978f6', namespace: 'starfolio-corpus-1446dc80e18f223baa6c-3d958533' },
  { issueWorkKey: 'sf-trans-2025-08-ling-hun', contentVersion: '3df38596f4736e38d505ee6f8b22254917f406b49433f62595cbd70b21957a1d', namespace: 'starfolio-corpus-1af7f71c406ad3a85960-f9efda4f' },
  { issueWorkKey: 'sf-trans-2025-08-remembered-salt', contentVersion: '3c7650960a07f2d2621afdb2af4a0b6abdeb3828b0bbd34f57c4ab59902f3ec3', namespace: 'starfolio-corpus-0bee981c5327b8dcea97-fff8a899' },
  { issueWorkKey: 'sf-trans-2025-08-tainted-cup-upper', contentVersion: 'd65039d441d258558188cec5480d73e05e03c5ba5c97002ccbca5888ba7c3aed', namespace: 'starfolio-corpus-f4a6f410cebd0ca26568-f6ad0e79' },
  { issueWorkKey: 'sf-trans-2025-08-witch-worlds-end', contentVersion: 'b2e3c199d6ef2c5994ff67826d6a6091c1e0ad3181d76304a338c71c139b0938', namespace: 'starfolio-corpus-ac370c2c5ff61c085bf6-1924b273' },
  { issueWorkKey: 'sf-trans-2025-09-beyond-botnet', contentVersion: '3679dcf03d5cc7d1da0e7ae834f12046c5371db0131967214e6bcf5c8ef662e1', namespace: 'starfolio-corpus-30b4548c317a54c71356-1b9d5fc6' },
  { issueWorkKey: 'sf-trans-2025-09-dying-light', contentVersion: '01e40b82c457afa6e2563ab302555d1a1f5e686d4a370234f753efbbc92fbdb8', namespace: 'starfolio-corpus-7b4c1e9bcf3b15649a88-1f8f86b6' },
  { issueWorkKey: 'sf-trans-2025-09-extra-beyond-botnet-introduction', contentVersion: '7f476bf211862c68bcdb45fa21ed329b45cc2a4eb6eceeec00d1f0e52caae70c', namespace: 'starfolio-corpus-fa239f3ce519a278dab4-8fd17a17' },
  { issueWorkKey: 'sf-trans-2025-09-extra-dying-light-introduction', contentVersion: '79df7e85b59c97619587357938a7d9755faeccc8e8b0aad6ce3cd22545c934f6', namespace: 'starfolio-corpus-3559ffadd4b7b5a72490-6f6b256a' },
  { issueWorkKey: 'sf-trans-2025-09-extra-float-where-we-will-introduction', contentVersion: '8bcc3f7e9ad4f0f50d1272dfb93f731151ac591d9d35c2f964a91e842c30301c', namespace: 'starfolio-corpus-1a3697d5abc6bdc4fb9e-706ccce0' },
  { issueWorkKey: 'sf-trans-2025-09-extra-kill-omelas-child-introduction', contentVersion: '265908c2e2f05397a135dd4ac908af53f7e7f7efa6f7d3c17075cd38dcac4598', namespace: 'starfolio-corpus-56bee4cffe4d0c469979-1930f55f' },
  { issueWorkKey: 'sf-trans-2025-09-extra-last-dreadnought-introduction', contentVersion: 'bc6822b5813156b4a73f605b533ceee7ee264e9dd733237e046884cb23a75069', namespace: 'starfolio-corpus-3fb8c42ca18f30183c30-585a2c05' },
  { issueWorkKey: 'sf-trans-2025-09-extra-performance-review-introduction', contentVersion: '063d4bf2c55fe2250773dfb03bbe091cc9afb58cc88ef21d243e695a72db9c5a', namespace: 'starfolio-corpus-4daa6c1534e5301ecd61-8427190d' },
  { issueWorkKey: 'sf-trans-2025-09-float-where-we-will', contentVersion: '4f904291b979223423d2f0a4bac1a489a853e7b3ecc5bc5f13b85daefe7dd5c3', namespace: 'starfolio-corpus-5fa515fbd07b09014208-22e4be12' },
  { issueWorkKey: 'sf-trans-2025-09-growing-up-weightless-upper', contentVersion: 'eafa911900399f97053ed73026e8ed850cbb5f0e5d15a3fcd2149312fe239ad0', namespace: 'starfolio-corpus-325e2fa471004b3a9c89-47ef2d1d' },
  { issueWorkKey: 'sf-trans-2025-09-kill-omelas-child', contentVersion: '2d5043505c0762a971e84170d3e00253ae3cf07c57caf3ef033a3cb66c88a3dd', namespace: 'starfolio-corpus-0c4b76aea9a1a4659e17-84a7c483' },
  { issueWorkKey: 'sf-trans-2025-09-last-dreadnought', contentVersion: 'c2bb16b12920ee3667f27ef979c7a982cb79548be2fd245e7837d94318c2e999', namespace: 'starfolio-corpus-7cf9e3209bde4c83c869-990a2c5b' },
  { issueWorkKey: 'sf-trans-2025-09-performance-review', contentVersion: 'b7411176545b11ed9a72506195092463b7b89dbe7d37bb126c1d2ceec8edb810', namespace: 'starfolio-corpus-cfecbce9d18f357bb78e-0e080999' },
  { issueWorkKey: 'sf-trans-2025-10-cold-blooded', contentVersion: 'cd47310ae1ef00b68b3066133df78f1a11580fcbbff496740630d7050e256d8e', namespace: 'starfolio-corpus-48f873dcbc0bf5d75699-8c142096' },
  { issueWorkKey: 'sf-trans-2025-10-extra-axolotl-profile', contentVersion: 'fa814d200a51f400d08d15a4bbccd6828299f0cb0f6828a6353c2f5795e9c38e', namespace: 'starfolio-corpus-6759bce801b48ddad6ff-601ac74f' },
  { issueWorkKey: 'sf-trans-2025-10-extra-catt-profile', contentVersion: '221d8d4909dfbfacfdc09efbbeec2981e9500b6a8b83919243bb0423a2f7d718', namespace: 'starfolio-corpus-9834a72e130e534ead47-74dfe625' },
  { issueWorkKey: 'sf-trans-2025-10-extra-cold-blooded-introduction', contentVersion: '8e5f0cdc8042554d66c31987ae0ff70183aeb82ec12dcb4e21c2efb8c0657fb3', namespace: 'starfolio-corpus-5eb0422f60e9f15914d9-c4fcf33c' },
  { issueWorkKey: 'sf-trans-2025-10-extra-faust-introduction', contentVersion: '57463f85ba91771926510cf660ae5f278f71088cda8218c79d6cbcdf979e73e3', namespace: 'starfolio-corpus-08d8ac56b8cf94e5aed0-8a7a5e88' },
  { issueWorkKey: 'sf-trans-2025-10-extra-festival-profile', contentVersion: 'b93c99d3173f4015cf785da0f1a8bfe692e44ff080696a9a087d541c26a63980', namespace: 'starfolio-corpus-c8d5fb5419047e4db097-c20217e0' },
  { issueWorkKey: 'sf-trans-2025-10-extra-marginalia-profile', contentVersion: 'efd50b3ad2539b9d537fce9f6485f0c01da272f0b701e816d61094bc86e00cf5', namespace: 'starfolio-corpus-3910a1aa2b211148fa2d-609c092c' },
  { issueWorkKey: 'sf-trans-2025-10-extra-pyramids-profile', contentVersion: 'd15f6dea4a0f2d2018e714b4fedbc5a14043ef99cd9d4aa59fddfa7587add49a', namespace: 'starfolio-corpus-6675698c74357a7c8201-ce465c9e' },
  { issueWorkKey: 'sf-trans-2025-10-extra-tainted-profile', contentVersion: '833642e5d57b0f670ce63ca009982fcdbec980539d01311f54e34ed0c1517ca8', namespace: 'starfolio-corpus-721861af5b88ee902370-4e617f64' },
  { issueWorkKey: 'sf-trans-2025-10-extra-witch-profile', contentVersion: '4422127c6e2daf6ee8705e2eac8243d9d4ba75adb853d5752215f2f3144f60c5', namespace: 'starfolio-corpus-8e963870d4a12cfd1eb2-90778799' },
  { issueWorkKey: 'sf-trans-2025-10-farewell-faust', contentVersion: '26a4a9a4b5f905a6e904c751939f8076c788dfa098bdc37e83a4c19ac9166cf0', namespace: 'starfolio-corpus-0a735a98c2417a9f73bc-cd3b2c13' },
  { issueWorkKey: 'sf-trans-2025-10-festival-dead', contentVersion: 'bfa9278c72b1de83e30f13bccea53fa27af88bb8c5732604a6136eec8dfec20a', namespace: 'starfolio-corpus-34c18d1d459b930b31a0-25e3e8a3' },
  { issueWorkKey: 'sf-trans-2025-10-marginalia', contentVersion: 'a2f11a86ff39db30c3a637f6f63b85039acf4dce1ca97cd3d324afa60dfc30b3', namespace: 'starfolio-corpus-5ddb39a5201410b59700-41d59232' },
  { issueWorkKey: 'sf-trans-2025-10-mr-axolotl', contentVersion: '7a3da6d1f461dbb712b68f2f42701289e3ea216dbe49037ccd2d546cb8809d37', namespace: 'starfolio-corpus-3047f352a05db20fe82b-21a395ba' },
  { issueWorkKey: 'sf-trans-2025-10-mr-catt', contentVersion: '1ae4317602578ae99dd004e47b1ddb5349e874ea89c0a4b19cf09c57634dada2', namespace: 'starfolio-corpus-46d27e22e391ae53e249-2bc79661' },
  { issueWorkKey: 'sf-trans-2025-10-tainted-cup-lower', contentVersion: 'f5f7c3b1e3120915aa3f09c02e2675f30366b7fedbed2b47c30ca63fd1e90124', namespace: 'starfolio-corpus-d7353ee14584902e4670-0a58edf2' },
  { issueWorkKey: 'sf-trans-2025-10-time-pyramids', contentVersion: '345ae18f80a65c3ca4e13c0cd42b35ab18608b62a1ca6859f28f69a71ac68883', namespace: 'starfolio-corpus-80404303ca5847fd8bd8-6242e3a2' },
  { issueWorkKey: 'sf-trans-2025-10-witch-wyrm', contentVersion: '93adcf318b099f2e66535fbbc32a77cd62c5e7ac08ecd02495cbf5965cc964b9', namespace: 'starfolio-corpus-855f1c45f65a1ad0e48d-c65c0123' },
  { issueWorkKey: 'sf-trans-2025-12-adjutants-dinner-guest', contentVersion: '4dedfe1aff1b133a7f130f96efe1dd64c6301a80cca755588ffa6aa8f6f58068', namespace: 'starfolio-corpus-0f5d801a44d7d3beb963-2df0ebe7' },
  { issueWorkKey: 'sf-trans-2025-12-beyond-portal', contentVersion: '0a8e6a2d14606fb67265be63f47efb720ed7e39f041d354098199942815f9d78', namespace: 'starfolio-corpus-865fc4ab942efc56ac72-745c0de4' },
  { issueWorkKey: 'sf-trans-2025-12-extra-adjutant-introduction', contentVersion: 'ae9f4f529c75df14adeecc39e848e967595bede6c537805dadb33a72904cda4d', namespace: 'starfolio-corpus-e2ae3b00b2cf8275df98-9df28e06' },
  { issueWorkKey: 'sf-trans-2025-12-extra-beyond-author-statement', contentVersion: 'ebf18aab7ee5d4ed9e0267f7c6af7959013a85ec52a61a18922a96f4beb2461b', namespace: 'starfolio-corpus-e4fc6f047eca5a0a73ac-a5d6358a' },
  { issueWorkKey: 'sf-trans-2025-12-extra-mother-introduction', contentVersion: 'c58e3469c37242db96a494411f017a6bd17006ec9673d00913f8cc83734cb3a1', namespace: 'starfolio-corpus-c5a5645bb12cb8f34ac3-9c387705' },
  { issueWorkKey: 'sf-trans-2025-12-extra-teeter-profile', contentVersion: '8a31578c3797f03c7722b10a694ce93374774267f74843cf1ed127407b3a0484', namespace: 'starfolio-corpus-fe186c1bd7f051201be4-398a7643' },
  { issueWorkKey: 'sf-trans-2025-12-extra-trout-introduction', contentVersion: '94bccd54f6441382395a48f11a6c43d534af94e2efd80d02518c5b581c7bd2d8', namespace: 'starfolio-corpus-96e88e0bda715e12148c-99d01ce7' },
  { issueWorkKey: 'sf-trans-2025-12-extra-wounds-introduction', contentVersion: '1e2ab5c61a93cf867f8dd66c6259d439219d7c5c35580e5c20068c70cda37882', namespace: 'starfolio-corpus-9933678d05320e58d96c-521374d5' },
  { issueWorkKey: 'sf-trans-2025-12-golden-trout', contentVersion: 'afe44e9fa613963bb1843e9dd6dda9eab0d0463569b8ad95806909a93a778d05', namespace: 'starfolio-corpus-2e443a5acb4db66149d1-f3e2bc32' },
  { issueWorkKey: 'sf-trans-2025-12-official-roast', contentVersion: 'c950f990907f8c18568a1a63047be6bc73657ee91f378186b8f9a23cf91434c7', namespace: 'starfolio-corpus-67bd473abfbfbeee1d0d-66b18cb1' },
  { issueWorkKey: 'sf-trans-2025-12-open-wounds-upper', contentVersion: '3d8d0ac117ee7e0704c7cc9a3209c4863ba26e10d43dd7d19376a938cef9e8d6', namespace: 'starfolio-corpus-15a829d582d8c0c1cedf-197946c1' },
  { issueWorkKey: 'sf-trans-2025-12-red-mother', contentVersion: 'd728f545d1e9e5b11190debcaa3b461453247e3277d4fee40f43dd282b2a46c4', namespace: 'starfolio-corpus-1ed9a4714e241d2a096e-565deff8' },
  { issueWorkKey: 'sf-trans-2025-12-teeter-totter', contentVersion: 'bbd3356cfc53b7478bf1c7271a33cffabf3d0339eef1e591185267cf8fba650f', namespace: 'starfolio-corpus-54eae35066ba4a9e8426-f6d688f9' },
);

namespaceMappings.push(
  {
    issueWorkKey: 'sf-trans-2024-01-province-of-saints',
    contentVersion: 'f858f9ff4d0e5dcaec0bdb3b0924a1a37ad964fe2a0f2d67cee288b72f0b4d14',
    namespace: 'starfolio-corpus-ecab7f58c89599e722b9-4c01c0b2',
  },
  {
    issueWorkKey: 'sf-trans-2024-02-value-of-money',
    contentVersion: 'c0c0e08fe3c665c7a2133e19b4177e8820724d09a997a0f4c7201f9fbae736ef',
    namespace: 'starfolio-corpus-eb2683d7d097bafc26c2-1918e81e',
  },
  {
    issueWorkKey: 'sf-trans-2024-03-premium-platinum-plan',
    contentVersion: '66a27718266c26eb8251fe05250cbb11c4bd955f6e723989ad1e0460ad80e560',
    namespace: 'starfolio-corpus-5041faf741c81572d468-460bd62b',
  },
  {
    issueWorkKey: 'sf-trans-2024-04-make-cow-into-a-ball',
    contentVersion: '8087e073028e16525a5deb6d85b7e5338b524f4155c92b21c76451fb3c5be998',
    namespace: 'starfolio-corpus-a01a3a6405feb854fe75-ee44fb42',
  },
  {
    issueWorkKey: 'sf-trans-2024-05-strawberry-taste',
    contentVersion: '082bdc7206d5e3257014a933bd13d9fce42d02b3a70be31f5919930076a5e892',
    namespace: 'starfolio-corpus-7c99c6aff217be917860-dd50fe3a',
  },
  {
    issueWorkKey: 'sf-trans-2024-06-pretty-good-neighbor',
    contentVersion: '788aa5b3ff94f8c61891fd3117d15dcc047f256d6b75730f36d2651403245f4d',
    namespace: 'starfolio-corpus-d5d2ecb6a0aeaa799cfc-238976ac',
  },
  {
    issueWorkKey: 'sf-trans-2024-07-missing-recipient',
    contentVersion: '2328cf63f9a1e44b454b7f9fa40d78fb2893b23ae6b0ea987664810eb8691863',
    namespace: 'starfolio-corpus-2403f7486c75df841232-54e61a2a',
  },
  {
    issueWorkKey: 'sf-trans-2024-08-armageddon',
    contentVersion: '571162919d39a00183f628fc0ad7910b171e6f9104f64adcc8cf1e54c83aa2e8',
    namespace: 'starfolio-corpus-d63fc38b0e01c9c5ebf7-aedfac4d',
  },
  {
    issueWorkKey: 'sf-trans-2024-09-spoil-heap',
    contentVersion: '9add0eaa1fd917216f5db44b20df40bc0b6eacb2bb0848bb762b3fb6224cffb1',
    namespace: 'starfolio-corpus-df5b5386b066146cf1e0-115c11e7',
  },
  {
    issueWorkKey: 'sf-trans-2024-10-self-spirit',
    contentVersion: '434fb662af02d97337f7b97d318aca49440198b65e9dddda1cc7aaf459ad896d',
    namespace: 'starfolio-corpus-f26a71c8ea0ba295454c-67ba9480',
  },
  {
    issueWorkKey: 'sf-trans-2024-11-tantie-merle',
    contentVersion: '5b791b668cd942f68ed462cde2dee7b7676728c168042996f3f2ef80a76281d8',
    namespace: 'starfolio-corpus-3de48006e1b2fb84e174-26957919',
  },
  {
    issueWorkKey: 'sf-trans-2024-12-leaf-by-niggle',
    contentVersion: '626d63e9aafe8a8608f474ee56d99077623fbe68c5f29dd337acffa912b73512',
    namespace: 'starfolio-corpus-be2c6c19a13221b62902-8c3594f0',
  },
);

export function namespaceFor(issueWorkKey: string, contentVersion: string) {
  return namespaceForVersion(namespaceMappings, issueWorkKey, contentVersion)
    ?? namespaceForVersion(namespaceMappings, issueWorkKey, '*');
}

export function namespacesForSearch() {
  return namespacesForMappings(namespaceMappings);
}

export function secret(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function indexHost() {
  const raw = secret('PINECONE_INDEX_HOST');
  const url = new URL(raw.startsWith('https://') ? raw : `https://${raw}`);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.pinecone.io') || url.pathname !== '/' || url.port || url.search || url.hash
    || secret('PINECONE_INDEX_NAME') !== corpus.index) throw new Error('Unexpected vector index configuration');
  return url;
}
