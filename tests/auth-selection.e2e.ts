import {test,expect,type Locator,type Page} from '@playwright/test';

async function dragToBackdrop(page:Page,source:Locator){
  await source.scrollIntoViewIfNeeded();
  const box=await source.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x+Math.min(100,box!.width/2),box!.y+box!.height/2);
  await page.mouse.down();
  await page.mouse.move(4,box!.y+box!.height/2,{steps:12});
  await page.mouse.up();
}

for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  test.describe(`${viewport.width}px authentication text selection`,()=>{
    test.use({viewport});
    test.beforeEach(async({page})=>{
      // These guest interactions do not need account or voice services.
      await page.route('**/api/**',route=>route.fulfill({json:{user:null}}));
      await page.addInitScript(()=>localStorage.setItem('wangxu-quality','low'));
      await page.goto('/');
      await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
    });

    for(const mode of ['登录','注册'] as const){
      test(`${mode}: dragging text outside keeps the dialog and entered values`,async({page})=>{
        const errors:string[]=[];
        page.on('pageerror',error=>errors.push(error.message));
        const dialog=page.getByRole('dialog');
        await dialog.getByRole('button',{name:mode,exact:true}).click();
        const email=dialog.getByLabel('邮箱',{exact:true});
        await email.fill('selection@example.test');
        const password=dialog.getByLabel('密码',{exact:true});
        await password.fill('Selection-test-123');
        const fields=[password];
        if(mode==='注册'){
          const nickname=dialog.getByLabel('显示昵称',{exact:true});
          await nickname.fill('归灯选择测试者');
          fields.push(nickname);
        }
        for(const field of fields){
          const value=await field.inputValue();
          await dragToBackdrop(page,field);
          await expect(dialog).toBeVisible({timeout:2000});
          await expect(field).toHaveValue(value);
          expect(await field.evaluate((input:HTMLInputElement)=>input.selectionEnd!>input.selectionStart!)).toBe(true);
        }
        await dragToBackdrop(page,dialog.getByRole('heading'));
        await expect(dialog).toBeVisible({timeout:2000});
        await expect(password).toHaveValue('Selection-test-123');
        await dragToBackdrop(page,email);
        await expect(dialog).toBeVisible({timeout:2000});
        await expect(email).toHaveValue('selection@example.test');
        expect(errors).toEqual([]);
      });
    }

    test('background click, close button and Escape still dismiss the dialog',async({page})=>{
      const dialog=page.getByRole('dialog');
      const box=await dialog.getByRole('heading').boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(4,box!.y+box!.height/2);
      await page.mouse.down();
      await page.mouse.move(box!.x+30,box!.y+box!.height/2,{steps:12});
      await page.mouse.up();
      await expect(dialog).toBeVisible({timeout:2000});
      await page.mouse.click(4,4);
      await expect(dialog).toHaveCount(0);
      await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
      await page.getByRole('button',{name:'关闭登录',exact:true}).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  });
}
