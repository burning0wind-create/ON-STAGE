const key=context=>context?.sessionId+':'+context?.questionId;
// Finishing speech only opens a review. Saving/advancing requires a separate choice.
export class AnswerConfirmation {
  constructor({voice,getContext,onShow,onHide=()=>{},onSubmit,onError=()=>{}}){Object.assign(this,{voice,getContext,onShow,onHide,onSubmit,onError});this.review=null;this.operation=0;this.opening=false;}
  async open(reason='manual'){
    if(this.opening||this.review)return;
    const context=this.getContext();if(!context.active||!context.questionId)return;
    const operation=++this.operation;this.opening=true;
    try{
      const text=await this.voice.stop({phase:'confirm'});
      if(operation!==this.operation||!this.getContext().active||key(context)!==key(this.getContext()))return;
      if(!text.trim()){await this.voice.stop();this.onError('还没有回答内容，点击“开始回答”或使用文字辅助。');return;}
      this.review={...context,text,reason};if(this.onShow(this.review)===false)this.review=null;
    }finally{if(operation===this.operation)this.opening=false;}
  }
  dismiss(){this.operation++;this.opening=false;this.review=null;this.onHide();}
  async continue(){
    const review=this.review;this.dismiss();
    if(!review||!this.getContext().active||key(review)!==key(this.getContext()))return;
    if(this.getContext().consent&&this.voice.state.recognitionSupported)await this.voice.continueAnswer();
    else await this.voice.stop();
  }
  async confirm(){
    const review=this.review,current=this.getContext();
    if(!review||!current.active||key(review)!==key(current)){this.dismiss();return;}
    this.dismiss();await this.onSubmit();
  }
}
