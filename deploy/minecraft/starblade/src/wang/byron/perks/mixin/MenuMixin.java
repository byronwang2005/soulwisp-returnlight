package wang.byron.perks.mixin;
import wang.byron.perks.Starblade;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.*;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(value=AbstractContainerMenu.class,remap=false)
public abstract class MenuMixin {
 @Inject(method="clicked",at=@At("HEAD"),cancellable=true)
 private void guard(int slot,int button,ClickType type,Player player,CallbackInfo ci){if(!Starblade.menuBefore((AbstractContainerMenu)(Object)this,slot,button,type,player))ci.cancel();}
 @Inject(method="clicked",at=@At("RETURN"))
 private void moved(int slot,int button,ClickType type,Player player,CallbackInfo ci){Starblade.menuAfter((AbstractContainerMenu)(Object)this,player);}
 @Inject(method="removed",at=@At("HEAD"))
 private void closing(Player player,CallbackInfo ci){Starblade.closing((AbstractContainerMenu)(Object)this,player);}
}
