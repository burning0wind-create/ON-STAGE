import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDeleteButton,renderDeleteConfirmation} from '../public/session-actions.js';

const session=()=>({id:'session-42',status:'complete',profile:{school:'目标大学',college:'设计学院',majorCode:'140300',major:'设计学',direction:'交互设计',nickname:'同学甲',interviewTime:'2026-11-05T09:30',attempt:3}});

test('仅已完成且具备标识的记录提供删除入口，入口本身不提交表单',()=>{
 const s=session(),button=renderDeleteButton(s,{compact:true});assert.match(button,/type="button"/);assert.match(button,/data-delete-session="session-42"/);assert.match(button,/删除记录/);assert.match(button,/目标大学，设计学，2026-11-05T09:30，第 3 次/);
 for(const status of ['active','paused','deleted']){assert.equal(renderDeleteButton({...s,status}),'');assert.equal(renderDeleteConfirmation({...s,status}),'');}
 assert.equal(renderDeleteButton({...s,id:''}),'');assert.equal(renderDeleteButton(null),'');
});

test('确认内容明确展示目标场次并将保留和确认删除分为独立动作',()=>{
 const html=renderDeleteConfirmation(session());
 for(const value of ['目标大学','设计学院','140300 / 设计学 / 交互设计','同学甲','2026-11-05 09:30','第 3 次'])assert.ok(html.includes(value));
 assert.match(html,/id="delete-session-title"/);assert.match(html,/id="delete-session-description"/);assert.match(html,/本地恢复备份/);assert.match(html,/简历、作品集不受影响/);
 assert.match(html,/data-delete-cancel>保留记录/);assert.match(html,/data-delete-confirm="session-42">确认删除/);assert.match(html,/id="delete-session-error"[^>]*role="alert" hidden/);
 assert.doesNotMatch(html,/<form|<script|\sonclick=|\sstyle=|href=|永久删除/);
});

test('场次标识与用户填写的说明均转义，不生成可执行标记',()=>{
 const s=session();s.id='q" onclick="bad()';s.profile.school='<img src=x onerror=bad()>';s.profile.nickname='</dd><script>bad()</script>';
 const html=renderDeleteButton(s)+renderDeleteConfirmation(s);assert.doesNotMatch(html,/<script>|<img|\sonclick="bad/);assert.match(html,/data-delete-confirm="q&quot; onclick=&quot;bad\(\)"/);assert.match(html,/&lt;script&gt;/);
});

test('旧记录缺少院系字段时仍保留可核对的字段和明确未填写状态',()=>{
 const html=renderDeleteConfirmation({id:'legacy',status:'complete'});assert.match(html,/<dt>面试时间<\/dt><dd>未填写/);assert.match(html,/data-delete-confirm="legacy"/);assert.doesNotMatch(html,/undefined|null/);
});
