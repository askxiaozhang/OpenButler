/** 真实浏览器 + DeepSeek 读图 + 私有存储 + 确认入库；只清理本次测试数据。 */
import {config} from 'dotenv';config({path:'.env.local',quiet:true});
import {randomBytes} from 'node:crypto';import {writeFile,unlink} from 'node:fs/promises';
import {db} from '../src/lib/db';import {hashPassword} from '../src/lib/auth/password';
import {encodeSession,SESSION_COOKIE_NAME} from '../src/lib/auth/session-token';
import {productStorage,productPreviewPath} from '../src/lib/products/storage';
import {normalizeProductIdentity} from '../src/lib/products/import-types';
import {confirmProductImport} from '../src/lib/chat/product-import';
import {openTab,waitFor,login} from './lib/cdp.mts';
const APP=process.env.VERIFY_BASE_URL??'http://localhost:3100';
const fixture='/tmp/family-chat-manual.pdf';
const password=randomBytes(24).toString('base64url');
const user=await db().user.create({data:{username:'verify-chat-product-'+Date.now(),displayName:'验证资料助手',role:'MEMBER',passwordHash:await hashPassword(password)}});
const other=await db().user.create({data:{username:'verify-chat-other-'+Date.now(),displayName:'验证其他家人',role:'MEMBER',passwordHash:await hashPassword(randomBytes(24).toString('base64url'))}});
const tab=await openTab(APP+'/login');
function assert(value:unknown,label:string){if(!value)throw Error(label);console.log('✓ '+label);}
function imagePdf(jpeg:Buffer):Buffer{
 const stream='q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ';
 const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 900 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),Buffer.from(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)];
 const buffers=[Buffer.from('%PDF-1.7\n')];const offsets=[0];let length=buffers[0].length;
 objects.forEach((body,i)=>{offsets.push(length);const b=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),body,Buffer.from('\nendobj\n')]);buffers.push(b);length+=b.length;});
 buffers.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));return Buffer.concat(buffers);
}
async function upload(){
 const dom=await tab.send('DOM.getDocument',{depth:-1}) as {root:{nodeId:number}};
 const input=await tab.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[aria-label="添加 PDF 说明书"]'}) as {nodeId:number};
 await tab.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[fixture]});
 assert(await waitFor(tab,"document.body.innerText.includes('已上传 · 发送后由管家识别产品')",90000),'在管家对话中上传 PDF 与扫描页预览');
}
async function send(text:string){
 await tab.eval(`(()=>{const el=document.querySelector('[aria-label="发送给管家的消息"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await tab.eval("document.querySelector('button[aria-label=发送]').click()");
}
try{
 if(process.env.PRODUCT_VERIFY_LOGIN==='1')assert(await login(tab,user.username,password),'线上普通账号实际登录');
 else await tab.send('Network.setCookie',{name:SESSION_COOKIE_NAME,value:encodeSession(user.id),url:APP,httpOnly:true,sameSite:'Lax'});
 await tab.send('Page.navigate',{url:APP+'/chat'});
 assert(await waitFor(tab,"document.querySelector('input[aria-label=\"添加 PDF 说明书\"]')",25000),'管家显示 PDF 附件入口');
 const jpeg=await tab.eval<string>(`(()=>{const c=document.createElement('canvas');c.width=900;c.height=1200;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,900,1200);x.fillStyle='#244b3b';x.font='bold 64px sans-serif';x.fillText('HOMELAB',70,150);x.fillStyle='#111';x.font='44px sans-serif';x.fillText('Air Purifier',70,280);x.fillText('Model: QV-7429',70,370);x.font='30px sans-serif';x.fillText('PRODUCT USER MANUAL',70,500);x.fillText('Filter replacement: every 6 months.',70,620);x.fillText('Hold POWER for 3 seconds to reset.',70,690);return c.toDataURL('image/jpeg',0.88).split(',')[1];})()`);
 await writeFile(fixture,imagePdf(Buffer.from(jpeg,'base64')));
 await upload();
 const draft=await db().productDocument.findFirstOrThrow({where:{uploadedBy:user.id,productId:null},orderBy:{createdAt:'desc'}});
 assert(draft.extractedText.trim()==='' && Array.isArray(draft.visionPages) && draft.visionPages.length===1,'测试 PDF 只有图片，必须依靠 AI 读图识别');
 if(process.env.PRODUCT_VERIFY_LOGIN!=='1'){
  const foreign=await fetch(APP+'/api/products/documents/'+draft.id+'/file',{headers:{cookie:`${SESSION_COOKIE_NAME}=${encodeSession(other.id)}`},redirect:'manual'});
  assert(foreign.status===404,'未确认的对话附件对其他已登录家人仍不可见');
 }
 await tab.send('Page.navigate',{url:APP+'/chat'});
 assert(await waitFor(tab,"document.body.innerText.includes('已上传 · 发送后由管家识别产品')",20000),'刷新页面后恢复未发送附件');
 await send('这是我家的空气净化器说明书，请识别产品并归档。');
 assert(await waitFor(tab,"document.querySelector('[aria-label=\"识别的型号\"]')?.value.includes('7429')",65000),'DeepSeek 实际读图识别扫描 PDF 的型号');
 const identified=await tab.eval<{brand:string;model:string;name:string}>(`({brand:document.querySelector('[aria-label="识别的品牌"]').value,model:document.querySelector('[aria-label="识别的型号"]').value,name:document.querySelector('[aria-label="识别的产品名称"]').value})`);
 assert(normalizeProductIdentity(identified.brand)==='homelab' && normalizeProductIdentity(identified.model)==='qv7429','品牌和型号来自扫描页，不是文件名猜测');
 assert(await db().product.count({where:{authorId:user.id}})===0,'识别阶段只产生草稿，不提前建档');
 await send('产品名称改成客厅净化器，型号保持 QV-7429。');
 assert(await waitFor(tab,"[...document.querySelectorAll('[aria-label=\"识别的产品名称\"]')].some(e=>!e.readOnly&&e.value.includes('客厅'))",65000),'通过对话纠正产品名称并生成新资料卡');
 await tab.eval("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认入库').click()");
 assert(await waitFor(tab,"document.body.innerText.includes('产品档案已建立')",30000),'点击确认后管家完成产品和 PDF 入库');
 const saved=await db().productDocument.findUniqueOrThrow({where:{id:draft.id},include:{product:true}});
 assert(saved.productId && saved.product?.name.includes('客厅'),'原 PDF 已关联到正确的产品档案');
 const confirmed=await db().chatMessage.findFirstOrThrow({where:{session:{userId:user.id},proposalStatus:'CONFIRMED'},orderBy:{createdAt:'desc'}});
 assert(await confirmProductImport(user.id,confirmed.id)===null && await db().product.count({where:{authorId:user.id}})===1,'重复确认不会创建第二份产品');
 await tab.send('Page.navigate',{url:APP+'/chat'});
 assert(await waitFor(tab,"document.body.innerText.includes('查看产品与说明书')",20000),'刷新后保留产品资料卡和资料库链接');
 await upload();await send('这是同一款产品的另一份说明书，请一起保存。');
 assert(await waitFor(tab,"document.body.innerText.includes('已找到同品牌、同型号产品')",65000),'识别同型号产品并建议归入已有档案');
 await tab.eval("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='确认归入').click()");
 assert(await waitFor(tab,"document.body.innerText.includes('已归入已有产品')",30000),'管家将另一份 PDF 归入已有产品');
 assert(await db().product.count({where:{authorId:user.id}})===1 && await db().productDocument.count({where:{uploadedBy:user.id,productId:saved.productId}})===2,'同型号两份说明书合并归档且不重复建产品');
 await tab.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
 await tab.eval("document.querySelector('[aria-label=\"说明书识别结果\"]')?.scrollIntoView({block:'center'})");
 const desktop=await tab.send('Page.captureScreenshot',{format:'png'}) as {data:string};await writeFile('/tmp/family-chat-products-desktop.png',Buffer.from(desktop.data,'base64'));
 await tab.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert(await waitFor(tab,'document.documentElement.scrollWidth<=innerWidth',5000),'手机对话和资料卡没有横向溢出');
 const mobile=await tab.send('Page.captureScreenshot',{format:'png'}) as {data:string};await writeFile('/tmp/family-chat-products-mobile.png',Buffer.from(mobile.data,'base64'));
 console.log('对话附件、AI 扫描识别、对话纠正、确认入库、重复产品合并，全流程通过');
}catch(error){
 console.error('浏览器验证失败：',await tab.eval('document.body.innerText.slice(-5000)').catch(()=>''));
 const screenshot=await tab.send('Page.captureScreenshot',{format:'png'}) as {data?:string};
 if(screenshot.data)await writeFile('/tmp/family-chat-products-failure.png',Buffer.from(screenshot.data,'base64'));
 throw error;
}finally{
 await tab.send('Page.navigate',{url:'about:blank'}).catch(()=>{});
 const docs=await db().productDocument.findMany({where:{uploadedBy:user.id}});
 if(docs.length){const paths=docs.flatMap(d=>[d.storagePath,...[1,2,3].map(p=>productPreviewPath(d.storagePath,p))]);const removed=await productStorage().remove(paths);if(removed.error)throw Error('Test storage cleanup failed');}
 await db().productDocument.deleteMany({where:{uploadedBy:user.id}});
 await db().product.deleteMany({where:{authorId:user.id}});
 await db().user.deleteMany({where:{id:{in:[user.id,other.id]}}});
 await unlink(fixture).catch(()=>{});tab.close();await db().$disconnect();
}
