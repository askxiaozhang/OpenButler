/** 验证浏览器 → 私有文件存储 → 正文索引 → 笔记。只清理本次创建的产品。 */
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../src/lib/auth/password';
import {config} from 'dotenv';config({path:'.env.local',quiet:true});
import {writeFile} from 'node:fs/promises';
import {db} from '../src/lib/db';
import {encodeSession,SESSION_COOKIE_NAME} from '../src/lib/auth/session-token';
import {openTab,waitFor,login} from './lib/cdp.mts';
import {productStorage} from '../src/lib/products/storage';
const APP=process.env.PRODUCT_VERIFY_URL??'http://localhost:3100';
const fixture='/tmp/family-product-manual.pdf';
const shot='/tmp/family-products-desktop.png';
function pdfFixture(){
 const objs=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ...['BT /F1 24 Tf 50 750 Td (Product Manual) Tj 0 -45 Td /F1 14 Tf (Page 1 - Getting started) Tj ET','BT /F1 24 Tf 50 750 Td (RESET-LIBRARY-7429) Tj 0 -45 Td /F1 14 Tf (Page 2 - Hold reset for 10 seconds.) Tj ET'].map(s=>`<< /Length ${s.length} >>\nstream\n${s}\nendstream`)
 ];
 let out='%PDF-1.7\n%'+ 'x'.repeat(Number(process.env.PRODUCT_VERIFY_PADDING_MB??5)*1024*1024)+'\n';const offsets=[0];
 objs.forEach((s,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${s}\nendobj\n`;});
 const xref=Buffer.byteLength(out);out+=`xref\n0 8\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return out;
}
function assert(value:unknown,label:string){if(!value)throw Error(label);console.log('✓ '+label);}
const useLogin=process.env.PRODUCT_VERIFY_LOGIN==='1';
const temporaryPassword=randomBytes(24).toString('base64url');
const user=useLogin ? await db().user.create({data:{username:'verify-products-'+Date.now(),displayName:'资料库验证账号',passwordHash:await hashPassword(temporaryPassword),role:'MEMBER'}}) : await db().user.findFirstOrThrow({where:{active:true,role:'ADMIN'}});
const session=await openTab(APP+'/products');
let productId:string|undefined;
try{
 await writeFile(fixture,pdfFixture());
 if(useLogin) { const loggedIn=await login(session,user.username,temporaryPassword); if(!loggedIn) console.log(await session.eval('JSON.stringify({path:location.pathname,error:document.querySelector(\"[role=alert]\")?.textContent,hasUsername:!!document.querySelector(\"#username\"),readyState:document.readyState})')); assert(loggedIn,'临时普通账号通过实际登录'); }
 else await session.send('Network.setCookie',{name:SESSION_COOKIE_NAME,value:encodeSession(user.id),url:APP,httpOnly:true,sameSite:'Lax'});
 await session.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await session.send('Page.navigate',{url:APP+'/products'});
 assert(await waitFor(session,"document.body.innerText.includes('给家里的每件东西')",20000),'资料库页面可访问');
 await session.eval("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('添加产品')).click()");
 assert(await waitFor(session,"document.querySelector('#product-name')",5000),'新建产品表单打开');
 const title='验证资料库-'+Date.now();
 await session.eval(`(()=>{const values={'product-name':${JSON.stringify(title)},'product-brand':'测试品牌','product-model':'Verify-7429','product-category':'验证分类'};for(const [id,value] of Object.entries(values)){const el=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('[role=dialog] form').requestSubmit();})()`);
 assert(await waitFor(session,"location.pathname.startsWith('/products/') && !!document.querySelector('input[type=file]')",20000),'通过界面创建产品');
 productId=await session.eval<string>('location.pathname.split("/").pop()');
 const dom=await session.send('DOM.getDocument',{depth:-1}) as {root:{nodeId:number}};
 const node=await session.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[type=file]'}) as {nodeId:number};
 await session.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[fixture]});
 assert(await waitFor(session,"document.body.textContent.includes('family-product-manual.pdf：已保存')",240000),'PDF 从浏览器直传成功');
 assert(await waitFor(session,"document.querySelector('canvas')?.width>0 && !document.body.innerText.includes('正在加载…')",30000),'PDF 阅读器渲染第一页');
 const document=await db().productDocument.findFirstOrThrow({where:{productId,ready:true}});
 assert(document.pageCount===2 && document.extractedText.includes('RESET-LIBRARY-7429'),'实际 PDF 正文提取并入库');
 await session.eval(`(()=>{const el=document.querySelector('[aria-label="搜索当前资料正文"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'RESET-LIBRARY-7429');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 assert(await waitFor(session,"[...document.querySelectorAll('button')].some(b=>b.textContent.includes('第 2 页 ·'))",10000),'正文搜索定位到第 2 页');
 await session.eval("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('第 2 页 ·')).click()");
 assert(await waitFor(session,"document.querySelector('[aria-label=跳转页码]')?.value==='2'",5000),'点击正文结果跳转到第 2 页');
 await session.eval(`(()=>{const el=document.querySelector('[aria-label="使用笔记内容"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'重置心得-VERIFY-NOTE-7429：长按十秒，不要短按。');el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[type=checkbox]').click();})()`);
 await session.eval("[...document.querySelectorAll('button')].find(b=>b.textContent==='记下来').click()");
 assert(await waitFor(session,"document.querySelector('[aria-label=产品笔记]')?.innerText.includes('查看说明书第 2 页')",15000),'笔记已保存并关联第 2 页');
 const note=await db().productNote.findFirstOrThrow({where:{productId}});
 assert(note.pageNumber===2 && note.documentId===document.id,'数据库笔记引用正确');
 // 页面重新打开后笔记仍在，且可跳回页码。
 await session.send('Page.navigate',{url:APP+'/products/'+productId});
 assert(await waitFor(session,"document.body.innerText.includes('查看说明书第 2 页')",15000),'刷新后笔记仍然存在');
 await session.eval("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('查看说明书第 2 页')).click()");
 assert(await waitFor(session,"document.querySelector('[aria-label=跳转页码]')?.value==='2'",15000),'从笔记跳回指定页');
 await session.send('Page.navigate',{url:APP+'/products?q=RESET-LIBRARY-7429'});
 assert(await waitFor(session,`document.body.innerText.includes(${JSON.stringify(title)})`,15000),'资料库能搜到 PDF 正文');
 await session.send('Page.navigate',{url:APP+'/products?q=VERIFY-NOTE-7429'});
 assert(await waitFor(session,`document.body.innerText.includes(${JSON.stringify(title)})`,15000),'资料库能搜到笔记内容');
 await session.send('Page.navigate',{url:APP+'/products/'+productId});
 assert(await waitFor(session,"document.querySelector('canvas')?.width>500 && !document.body.innerText.includes('正在加载…') && !document.body.innerText.includes('正在打开资料…')",30000),'截图前确认 PDF 页面完成渲染');
 await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(async(r)=>writeFile(shot,Buffer.from((r as {data:string}).data,'base64')));
 await session.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert(await waitFor(session,'document.documentElement.scrollWidth<=window.innerWidth',5000),'手机视口没有横向溢出');
 await session.eval("document.querySelector('[aria-label=资料阅读器]').scrollIntoView({block:'center'})");
 await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(async(r)=>writeFile('/tmp/family-products-mobile.png',Buffer.from((r as {data:string}).data,'base64')));
 const anonymous=await fetch(APP+'/api/products/documents/'+document.id+'/file',{redirect:'manual'});
 assert(anonymous.status===401,'未登录不能获取私有文件链接');
 const unsigned=await fetch(process.env.SUPABASE_URL+'/storage/v1/object/public/product-library/'+document.storagePath);
 assert(!unsigned.ok,'存储对象不能通过公开链接读取');
 await session.eval("window.confirm=()=>true;document.querySelector('button[aria-label=\"删除 family-product-manual.pdf\"]').click()");
 assert(await waitFor(session,"!document.body.innerText.includes('查看说明书第 2 页') && document.body.innerText.includes('重置心得-VERIFY-NOTE-7429')",15000),'删除原文件仍保留笔记');
 const detached=await db().productNote.findUniqueOrThrow({where:{id:note.id}});
 assert(detached.documentId===null && detached.pageNumber===null,'文件删除后清除失效页码引用');
 console.log('完整产品资料库流程通过。截图：'+shot);
}finally{
 await session.send('Page.navigate',{url:'about:blank'}).catch(()=>{});
 if(productId){const docs=await db().productDocument.findMany({where:{productId},select:{storagePath:true}});if(docs.length){const removed=await productStorage().remove(docs.map(d=>d.storagePath));if(removed.error)throw Error('测试文件清理失败');}await db().product.delete({where:{id:productId}});}
 if(useLogin) await db().user.delete({where:{id:user.id}});
 session.close();await db().$disconnect();
}
