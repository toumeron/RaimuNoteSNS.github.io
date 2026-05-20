import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, ShieldAlert, Scale, ShieldCheck, Eye, HelpCircle, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/layout/Logo';

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-start overflow-y-auto p-4 bg-white dark:bg-zinc-950 text-foreground transition-colors duration-200 sm:p-8">
      <div className="w-full max-w-3xl">
        
        {/* ヘッダーエリア */}
        <div className="mb-8 flex flex-col items-center justify-between gap-4 border-b border-border/60 dark:border-zinc-800 pb-6 pt-4 sm:flex-row sm:pt-0">
          <div className="flex items-center gap-3">
            <Logo size="md" />
            <span className="text-xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">利用規約</span>
          </div>
        </div>

        {/* 規約本文カード */}
        <div className="rounded-3xl border border-border/60 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-card-soft sm:p-10 transition-colors duration-200">
          
          <div className="mb-8 flex items-center gap-3 text-primary">
            <FileText className="h-6 w-6" />
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">LimeNote 利用規約</h1>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 mb-8">
            本利用規約（以下「本規約」といいます）は、管理者たる「ねこ氏」（以下「管理者」といいます）が提供するソーシャルネットワーキングサービス「LimeNote」（以下「本サービス」といいます）の利用条件を定めるものです。本サービスを利用するすべての登録ユーザー（以下「ユーザー」といいます）は、アカウントを作成した時点で、本規約の全条項に完全、無条件、かつ永久的に同意したものとみなされます。
          </p>

          <div className="space-y-8">
            
            {/* 第1条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <Scale className="h-4 w-4 text-primary" />
                <h2>第1条（目的および適用範囲）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. 本規約は、本サービスの利用に関するユーザーと管理者との間の権利義務関係を定めることを目的とし、ユーザーと管理者との間の本サービスの利用に関わる一切の関係に適用されます。</p>
                <p>2. 管理者が本サービス上で随時発表するガイドライン、ルール、注意事項その他の規定（以下「個別規定」といいます）は、本規約の一部を構成するものとします。本規約と個別規定の内容が矛盾する場合は、個別規定が優先して適用されます。</p>
              </div>
            </section>

            {/* 第2条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <HelpCircle className="h-4 w-4 text-primary" />
                <h2>第2条（定義）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>本規約において使用する以下の用語は、各々以下に定める意味を有するものとします。</p>
                <p>(1) 「登録情報」とは、ユーザーが本サービスを利用するにあたり、管理者に提供した一切の情報をいいます。</p>
                <p>(2) 「ユーザーコンテンツ」とは、ユーザーが本サービスを利用して投稿、送信、アップロードしたテキスト、画像、動画、音声、その他一切の情報をいいます。</p>
                <p>(3) 「タイムライン」とは、ユーザーコンテンツが時系列で表示される本サービス内の領域をいいます。</p>
                <p>(4) 「ダイレクトメッセージ（DM）」とは、特定のユーザー間で非公開の通信を行うための本サービス内の機能をいいます。</p>
              </div>
            </section>

            {/* 第3条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2>第3条（アカウントの登録および管理）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. 本サービスの利用を希望する者（以下「登録希望者」といいます）は、本規約を遵守することに同意し、かつ管理者の定める一定の情報（以下「登録事項」といいます）を管理者の定める方法で提供することにより、本サービスの利用登録を申請することができます。</p>
                <p>2. 登録申請は必ず本サービスを利用する個人または法人自身が行わなければならず、原則として代理人による申請は認められないものとします。また、登録希望者は、登録事項の登録にあたり、真実、正確かつ最新の情報を管理者に提供しなければなりません。</p>
                <p>3. 管理者は、管理者の絶対的な裁量により、登録希望者の登録の可否を判断します。管理者が登録を承認した場合に限り、ユーザーとしてのアカウント（以下「アカウント」といいます）が発行されます。</p>
                <p>4. ユーザーは、自己の責任において、本サービスに関するパスワードおよびユーザーIDを適切に管理および保管するものとし、これを第三者に利用させ、または貸与、譲渡、名義変更、売買等をしてはならないものとします。</p>
                <p>5. パスワードまたはユーザーIDの管理不十分、使用上の過誤、第三者の使用等によって生じた損害に関する責任はユーザーが負うものとし、管理者は一切の責任を負いません。</p>
              </div>
            </section>

            {/* 第4条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <Eye className="h-4 w-4 text-primary" />
                <h2>第4条（監視およびデータ収集への同意）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. 本サービスは、プラットフォームの健全な秩序、および管理者の安全と尊厳を維持するため、ユーザーのすべての行動を常時監視・記録します。ユーザーはアカウントを開設した時点で、この監視に無条件で同意したものとみなされます。</p>
                <p>2. 監視対象には、公開投稿、タイムラインへの表示内容、非公開設定のコンテンツ、ダイレクトメッセージ（DM）の送受信履歴およびその内容、下書き保存されたテキスト、検索履歴、閲覧履歴、いいね・リツイート等のアクティビティ、ログインIPアドレス、ブラウザ情報、位置情報等、本サービスを通じて取得可能な一切の情報が含まれます。</p>
                <p>3. ユーザーは、本サービス内において通信の秘密やプライバシーの権利を管理者に主張することはできず、管理者が秩序維持（管理者の主観に基づく）のためにこれらの情報を閲覧、解析、第三者へ提供、または制裁の証拠として使用することに異議を唱えないものとします。</p>
              </div>
            </section>

            {/* 第5条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <Scale className="h-4 w-4 text-primary" />
                <h2>第5条（ユーザーコンテンツの知的財産権および検閲）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. ユーザーは、自らが本サービスに投稿したユーザーコンテンツについて、自らが投稿その他送信することについての適法な権利を有していること、およびユーザーコンテンツが第三者の権利を侵害していないことについて、管理者に表明し、保証するものとします。</p>
                <p>2. ユーザーが本サービス上に投稿した一切のユーザーコンテンツの著作権（著作権法第27条および第28条に定める権利を含みます）は、投稿が完了した瞬間に、無償で管理者に譲渡され、管理者に帰属するものとします。</p>
                <p>3. ユーザーは、管理者および管理者から権利を承継しまたは許諾された者に対して、著作者人格権を一切行使しないことに同意します。</p>
                <p>4. 管理者は、本サービスの秩序維持および運営上の都合により、ユーザーの事前の承諾を得ることなく、ユーザーコンテンツを検閲し、文意の変更、削除、または「管理者への感謝や賛美」を付加するなどの改変を自由に行う権利を有します。ユーザーはこれに対し、いかなる異議も申し立てることはできません。</p>
              </div>
            </section>

            {/* 第6条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <h2>第6条（禁止事項）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>ユーザーは、本サービスの利用にあたり、以下の各号のいずれかに該当する行為または該当すると管理者が判断する行為をしてはなりません。</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>法令に違反する行為または犯罪行為に関連する行為</li>
                  <li>管理者、本サービスの他のユーザーまたはその他の第三者に対する詐欺または脅迫行為</li>
                  <li>公序良俗に反する行為</li>
                  <li>管理者、本サービスの他のユーザーまたはその他の第三者の知的財産権、肖像権、プライバシーの権利、名誉、その他の権利または利益を侵害する行為</li>
                  <li>本サービスのネットワークまたはシステム等に過度な負荷をかける行為</li>
                  <li>本サービスの運営を妨害するおそれのある行為</li>
                  <li>管理者のネットワークまたはシステム等に不正にアクセスし、または不正にアクセスを試みる行為</li>
                  <li>第三者に成りすます行為</li>
                  <li>本サービスの他のユーザーのIDまたはパスワードを利用する行為</li>
                  <li>本サービス上での宣伝、広告、勧誘、または営業行為（管理者が事前に認めたものを除く）</li>
                  <li>本サービスの他のユーザーの情報の収集</li>
                  <li>反社会的勢力等への利益供与</li>
                  <li>前各号の行為を直接または間接に惹起し、または容易にする行為</li>
                </ul>
              </div>
            </section>

            {/* 第7条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <h2>第7条（禁止事項）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>ユーザーは、前条に定める一般的な禁止事項のほか、本サービスの根幹たる秩序を維持するため、以下の行為をしてはなりません。これらの行為の有無は、客観的証拠の有無にかかわらず、管理者の主観と単独の裁量によってのみ判定されます。</p>
                <p>(1) 管理者「ねこ氏」に対する批判、非難、不満の表明、侮辱、またはそれに類する一切の行為。</p>
                <p>(2) 管理者の決定、指示、または発言に対する疑問の呈示、反論、または論破の試み。</p>
                <p>(3) 暗喩、皮肉、縦読み、隠語、その他いかなる表現手法を用いているかを問わず、管理者の尊厳を傷つける、または管理者を不快にさせると管理者が判断した一切の発言。</p>
                <p>(4) 本サービスの仕様、アルゴリズム、UI/UX、機能、動作速度、または本規約そのものに対する不満の表明。</p>
                <p>(5) 「使いにくい」「バグが多い」「以前の仕様の方が良かった」「他サービスの方が優れている」等、本サービスの価値や評判を貶める発言。</p>
                <p>(6) 他のユーザーに対し、本サービスまたは管理者への不満を共有し、扇動または共感を集めようとする行為、およびそれらに「いいね」や拡散を行う行為。</p>
                <p>(7) 競合他社が提供する他のSNSやプラットフォームの名称を肯定的な文脈で言及する行為、および「別のアカウントに移行する」「LimeNoteをやめる」等、退会を示唆することでコミュニティの離反を煽る行為。</p>
                <p>(8) 本サービスの利用体験に対して、常に感謝と喜びを表明しない行為（無言による無視、管理者の投稿に対する無反応を含みます）。</p>
              </div>
            </section>

            {/* 第8条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <h2>第8条（違反行為に対する措置および強制凍結）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. ユーザーが第6条または第7条の禁止事項に違反したと管理者が判断した場合、管理者は事前の通知または催告を要することなく、直ちに以下の措置を単独または複合して実行することができます。</p>
                <div className="pl-4 space-y-1">
                  <p>(1) 違反に該当するユーザーコンテンツの全部または一部の削除、改変</p>
                  <p>(2) アカウントの機能の一部制限（投稿禁止、DM禁止、閲覧のみへの制限等）</p>
                  <p>(3) アカウントの永久凍結または即時削除</p>
                  <p>(4) IPアドレス、端末識別番号等に基づく本サービスへの恒久的なアクセス遮断</p>
                  <p>(5) 違反ユーザーのアカウント名、登録情報、および違反内容を「秩序破壊者」として本サービス内で公式に晒し上げ、他のユーザーからの非難や通報を推奨する措置</p>
                </div>
                <p>2. 前項の措置は、管理者の完全な裁量によって行われるものであり、管理者は措置の理由を開示する義務を負いません。また、措置によりユーザーに生じたいかなる損害についても、管理者は一切の責任を負いません。</p>
              </div>
            </section>

            {/* 第9条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <ShieldAlert className="h-4 w-4 text-zinc-500" />
                <h2>第9条（退会の制限および事後監視）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. ユーザーは、原則として自己の意志のみで本サービスを退会することはできません。退会を希望する場合は、管理者が指定する申請フォームより理由を明記の上、退会申請を行い、管理者の明示的な承認を得る必要があります。</p>
                <p>2. 本サービスまたは管理者への不満、批判、抗議を理由とした退会申請は、第7条の禁止事項違反とみなされ、退会は承認されず、第8条に基づく強制凍結および制裁の対象となります。</p>
                <p>3. アカウントが削除または強制凍結された後であっても、元ユーザーは本サービスおよび管理者に対する批判、内部情報の漏洩、不満の表明をインターネット上のいかなる場所（外部SNS、ブログ、匿名掲示板等を含みますがこれらに限られません）においても行ってはなりません。本条項への違反が確認された場合、管理者は該当者に対し、法的な手段をもって徹底的な追及を行う権利を留保します。</p>
              </div>
            </section>

            {/* 第10条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <Landmark className="h-4 w-4 text-destructive" />
                <h2>第10条（損害賠償および違約金）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. ユーザーは、本規約に違反することにより、または本サービスの利用に関連して管理者に損害を与えた場合、管理者に対しその損害（弁護士費用、サーバー復旧費用、および管理者の精神的苦痛に対する慰謝料を含みます）を賠償しなければなりません。</p>
                <p>2. 特に、第7条第1号から第3号に定める「管理者への批判・不敬行為」、または同条第4号から第6条に定める「LimeNoteへの批判行為」に該当すると管理者が判断した場合、ユーザーは管理者に対し、実際の損害額の多寡にかかわらず、違約金として一律金1,000万円を、管理者が指定する期日までに直ちに支払うものとします。</p>
              </div>
            </section>

            {/* 第11条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <ShieldAlert className="h-4 w-4 text-zinc-500" />
                <h2>第11条（本サービスの変更、中断、終了）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. 管理者は、ユーザーに事前に通知することなく、本サービスの内容の全部または一部を変更または追加することができるものとします。</p>
                <p>2. 管理者は、以下のいずれかに該当する場合には、ユーザーに事前に通知することなく、本サービスの利用の全部または一部を停止または中断することができるものとします。</p>
                <div className="pl-4 space-y-1">
                  <p>(1) 本サービスに係るコンピューター・システムの点検または保守作業を行う場合</p>
                  <p>(2) コンピューター、通信回線等が事故により停止した場合</p>
                  <p>(3) 地震、落雷、火災、風水害、停電、天災地変などの不可抗力により本サービスの運営ができなくなった場合</p>
                  <p>(4) 管理者が個人的に休息、休暇、または精神的静養を必要と判断した場合</p>
                  <p>(5) その他、管理者が停止または中断を必要と判断した場合</p>
                </div>
                <p>3. 管理者は、管理者の都合により、本サービスの提供を終了することができます。この場合、管理者はユーザーに事前に通知するよう努めますが、緊急を要する場合は通知なしに即時終了できるものとします。</p>
                <p>4. 管理者は、本条に基づき管理者が行った措置に基づきユーザーに生じた損害について、一切の責任を負いません。</p>
              </div>
            </section>

            {/* 第12条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <Scale className="h-4 w-4 text-zinc-500" />
                <h2>第12条（規約の変更および遡及適用）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. 管理者は、本規約をいつでも任意に変更することができるものとします。</p>
                <p>2. 変更後の本規約は、本サービス上の適当な場所に掲示された時点、またはユーザーに通知された時点から効力を生じるものとします。</p>
                <p>3. 管理者が必要と判断した場合、変更後の規約は、ユーザーが過去に行ったすべての行動および投稿に対しても遡及して適用されるものとします。これにより、投稿当時は違反でなかったコンテンツが変更後の規約により違反とみなされた場合であっても、ユーザーは第8条および第10条の制裁および違約金支払いの対象となります。</p>
              </div>
            </section>

            {/* 第13条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <Scale className="h-4 w-4 text-zinc-500" />
                <h2>第13条（免責事項）</h2>
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6 space-y-2">
                <p>1. 管理者は、本サービスがユーザーの特定の目的に適合すること、期待する機能・商品価値・正確性・有用性を有すること、ユーザーによる本サービスの利用がユーザーに適用のある法令または業界団体の内部規則等に適合すること、および不具合が生じないことについて、何ら保証するものではありません。</p>
                <p>2. 管理者は、本サービスからリンクされた外部ウェブサイト等の内容の正確性、合法性、道徳性について一切関知せず、それらを利用したことによりユーザーに生じた損害について一切の責任を負いません。</p>
                <p>3. ユーザーは、本サービスを利用することが、自らの端末機器、データ、または通信環境に悪影響を及ぼさないことを自らの責任で確認するものとし、本サービスの利用に伴う端末の故障、データの消失、通信費の増大等について、管理者は一切の責任を負いません。</p>
              </div>
            </section>

            {/* 第14条 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-bold">
                <Scale className="h-4 w-4 text-zinc-500" />
                <h2>第14条（連絡および通知）</h2>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground dark:text-zinc-400 pl-6">
                本サービスに関する問い合わせその他ユーザーから管理者に対する連絡または通知、および本規約の変更に関する通知その他管理者からユーザーに対する連絡または通知は、管理者の定める方法で行うものとします。管理者がユーザーから提供された連絡先に通知を行った場合、当該通知は通常到達すべき時に到達したものとみなします。
              </p>
            </section>
          </div>

          {/* フッター情報 */}
          <div className="mt-12 border-t border-dashed border-border/60 dark:border-zinc-800 pt-6 text-right text-xs text-muted-foreground dark:text-zinc-500 space-y-1">
            <p>【附則】</p>
            <p>本規約は、2025年1月1日より制定・施行します。</p>
            <p className="mt-2 font-medium text-zinc-700 dark:text-zinc-400">LimeNote</p>
          </div>

        </div>
      </div>
    </div>
  );
}