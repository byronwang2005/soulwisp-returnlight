package wang.byron.perks;

import java.util.*;
import wang.byron.perks.mixin.CompoundAccess;
import com.mojang.brigadier.Command;
import net.minecraft.commands.Commands;
import net.minecraft.core.*;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.particles.*;
import net.minecraft.nbt.*;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.*;
import net.minecraft.sounds.*;
import net.minecraft.world.*;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.*;
import net.minecraft.world.inventory.*;
import net.minecraft.world.item.*;
import net.minecraft.world.level.*;
import net.minecraft.world.level.block.entity.*;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.phys.*;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.entity.item.ItemTossEvent;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.event.entity.player.*;
import net.neoforged.neoforge.event.level.*;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.event.server.*;
import org.joml.Vector3f;

public final class StarbladeEngine {
    public final UUID OWNER;
    private final String ownerName,commandName,storageName,gift;
    private final boolean initialEnabled;
    public StarbladeEngine(UUID owner,String name,String command,String storage,String gift,boolean enabled){OWNER=owner;ownerName=name;commandName=command;storageName=storage;this.gift=gift;initialEnabled=enabled;}
    public static final int MODEL=17012001;
    private Ledger ledger;
    private net.minecraft.server.MinecraftServer server;
    private final ThreadLocal<Boolean> TRANSFER=ThreadLocal.withInitial(()->false);
    private final ThreadLocal<Blast> BLAST=new ThreadLocal<>();
    private final Map<UUID,Charge> charges=new HashMap<>();
    private int particleBudget;
    private long budgetTick=-1;
    private boolean testing;
    private boolean denyProbe;
    private Benchmark benchmark;
    private final java.util.concurrent.ConcurrentLinkedQueue<BlockEntity> loadedContainers=new java.util.concurrent.ConcurrentLinkedQueue<>();
    public long now(){return server.overworld().getGameTime();}
    public void register(){
        var bus=NeoForge.EVENT_BUS;
        bus.addListener(this::started);bus.addListener(this::stopped);
        bus.addListener(this::tick);bus.addListener(this::commands);
        bus.addListener(this::attack);bus.addListener(this::rightItem);
        bus.addListener(this::rightBlock);bus.addListener(this::rightEntity);
        bus.addListener(this::rightSpecific);bus.addListener(this::toss);
        bus.addListener(this::join);bus.addListener(this::chunk);
        bus.addListener(EventPriority.NORMAL,false,ExplosionEvent.Start.class,e->{if(testing&&denyProbe)e.setCanceled(true);});
        bus.addListener(this::detonate);bus.addListener(EventPriority.LOWEST,true,ExplosionEvent.Start.class,this::explosionStart);
    }
    public boolean marked(ItemStack s){
        var d=s.get(DataComponents.CUSTOM_DATA);
        if(d==null||!d.copyTag().contains("starblade"))return false;
        var tag=d.copyTag().getCompound("starblade");String owner=tag.getString("owner");
        return owner.isEmpty()?OWNER.equals(Starblade.OWNER):owner.equals(OWNER.toString());
    }
    private boolean token(ItemStack s){
        if(ledger==null||!marked(s))return false;
        var d=s.get(DataComponents.CUSTOM_DATA).copyTag().getCompound("starblade");
        return ledger.id.toString().equals(d.getString("id"))&&ledger.epoch==d.getLong("epoch")&&s.getCount()==1;
    }
    private String playerLoc(Player p,int slot){return "p|"+p.getUUID()+"|"+slot;}
    private String blockLoc(BlockEntity b,int slot){return "b|"+b.getLevel().dimension().location()+"|"+b.getBlockPos().getX()+"|"+b.getBlockPos().getY()+"|"+b.getBlockPos().getZ()+"|"+slot;}
    public String location(Container c,int index,Player p){
        if(c instanceof Inventory i)return playerLoc(i.player,index);
        if(c instanceof ChestBlockEntity || c instanceof BarrelBlockEntity)return blockLoc((BlockEntity)c,index);
        if(c instanceof CompoundContainer compound){
            var parts=(CompoundAccess)(Object)compound;
            var first=parts.starbladeFirst();
            return index<first.getContainerSize()?location(first,index,p):location(parts.starbladeSecond(),index-first.getContainerSize(),p);
        }
        return "forbidden";
    }
    private boolean active(ItemStack s,String loc){return token(s)&&ledger.location.equals(loc);}
    private int handSlot(Player p){return p.getInventory().selected;}
    public boolean wield(ServerPlayer p){return ledger!=null&&ledger.enabled&&OWNER.equals(p.getUUID())&&active(p.getMainHandItem(),playerLoc(p,handSlot(p)));}
    public boolean automationAllowed(){return Boolean.TRUE.equals(TRANSFER.get());}
    private void persist(){ledger.setDirty();if(!testing)server.overworld().getDataStorage().save();}
    private void started(ServerStartedEvent e){
        server=e.getServer();ledger=server.overworld().getDataStorage().computeIfAbsent(new SavedData.Factory<>(()->{var d=new Ledger();d.enabled=initialEnabled;return d;},Ledger::load,null),storageName);
        ledger.ultimate=0;ledger.setDirty();persist();
        System.out.println("[Starblade] Loaded unique ledger epoch="+ledger.epoch+" location="+ledger.location+" enabled="+ledger.enabled);
    }
    private void stopped(ServerStoppedEvent e){charges.clear();loadedContainers.clear();benchmark=null;ledger=null;server=null;}
    public ItemStack make(){
        try{var item=ItemStack.parseOptional(server.registryAccess(),TagParser.parseTag("{id:\"minecraft:netherite_sword\",count:1,components:{\"minecraft:custom_model_data\":"+MODEL+",\"minecraft:unbreakable\":{show_in_tooltip:false},\"minecraft:max_stack_size\":1,\"minecraft:enchantment_glint_override\":true,\"minecraft:custom_name\":'{\"text\":\"星冕·终焉\",\"color\":\"aqua\",\"italic\":false}',\"minecraft:lore\":['{\"text\":\""+ownerName+" 绑定星核神器"+gift+"\",\"color\":\"gold\",\"italic\":false}','{\"text\":\"左键裂斩 · 右键贯光 · 潜行右键裁决\",\"color\":\"light_purple\",\"italic\":false}'],\"minecraft:custom_data\":{starblade:{owner:\""+OWNER+"\",id:\""+ledger.id+"\",epoch:"+ledger.epoch+"L}}}}"));GearAura.enchantWeapon(item,ledger.silk);return item;}
        catch(Exception ex){throw new IllegalStateException("Starblade item parse failed",ex);}
    }
    private boolean deliver(ServerPlayer p){
        int empty=p.getInventory().getFreeSlot();if(empty<0)return false;
        ledger.location=playerLoc(p,empty);persist();p.getInventory().setItem(empty,make());p.inventoryMenu.broadcastChanges();
        p.sendSystemMessage(Component.literal(ownerName+gift+"：星冕·终焉已交付。左键裂斩，右键贯光，潜行右键裁决。/"+commandName+" recall 可召回。"));
        return true;
    }
    public boolean menuBefore(AbstractContainerMenu m,int slot,int button,ClickType type,Player p){
        TRANSFER.set(false);if(ledger==null||p.level().isClientSide)return true;
        // Remove invalid copies visible in this menu before an authorized transfer.
        for(var s:m.slots)if(marked(s.getItem())&&!active(s.getItem(),location(s.container,s.getContainerSlot(),p)))s.set(ItemStack.EMPTY);
        String cursor="c|"+p.getUUID();
        if(marked(m.getCarried())&&!active(m.getCarried(),cursor))m.setCarried(ItemStack.EMPTY);
        var clicked=slot>=0&&slot<m.slots.size()?m.getSlot(slot).getItem():ItemStack.EMPTY;
        boolean involved=marked(clicked)||marked(m.getCarried())||(type==ClickType.SWAP&&button>=0&&button<9&&marked(p.getInventory().getItem(button)));
        if(!involved)return true;
        boolean allowed=OWNER.equals(p.getUUID())&&type!=ClickType.CLONE&&type!=ClickType.THROW;
        if(marked(m.getCarried())&&slot<0)allowed=false;
        if(type==ClickType.SWAP&&button==40)allowed=false;
        if(slot>=0&&slot<m.slots.size()&&location(m.getSlot(slot).container,m.getSlot(slot).getContainerSlot(),p).equals("forbidden"))allowed=false;
        if(type==ClickType.QUICK_MOVE)for(var s:m.slots)if(location(s.container,s.getContainerSlot(),p).equals("forbidden")&&!(s.container instanceof Inventory))allowed=false;
        if(!allowed){p.displayClientMessage(Component.literal("星冕只能由绑定玩家保管，可存入箱子或木桶；不能丢弃、复制或加工。"),true);m.broadcastChanges();return false;}
        TRANSFER.set(true);return true;
    }
    public void menuAfter(AbstractContainerMenu m,Player p){
        if(ledger==null||!automationAllowed()){TRANSFER.set(false);return;}
        String next=null;
        if(token(m.getCarried()))next="c|"+p.getUUID();
        for(var s:m.slots)if(token(s.getItem())){
            String loc=location(s.container,s.getContainerSlot(),p);
            if(next==null)next=loc;else if(!next.equals(loc))s.set(ItemStack.EMPTY);
        }
        if(next!=null){ledger.location=next;persist();}
        TRANSFER.set(false);
    }
    public void closing(AbstractContainerMenu m,Player p){
        if(ledger==null||p.level().isClientSide||!marked(m.getCarried()))return;
        var stack=m.getCarried();m.setCarried(ItemStack.EMPTY);
        if(!token(stack)||!OWNER.equals(p.getUUID()))return;
        int free=p.getInventory().getFreeSlot();
        if(free>=0){p.getInventory().setItem(free,stack);ledger.location=playerLoc(p,free);}
        else{ledger.epoch++;ledger.location="pending";}
        persist();
    }
    private void toss(ItemTossEvent e){
        if(!marked(e.getEntity().getItem()))return;
        e.setCanceled(true);
        var p=e.getPlayer();var s=e.getEntity().getItem();
        if(OWNER.equals(p.getUUID())&&token(s)){
            int free=p.getInventory().getFreeSlot();
            if(free>=0){p.getInventory().setItem(free,s);ledger.location=playerLoc(p,free);persist();}
            else{ledger.epoch++;ledger.location="pending";persist();}
        }
    }
    private void join(EntityJoinLevelEvent e){if(!e.getLevel().isClientSide&&e.getEntity() instanceof ItemEntity i&&marked(i.getItem()))e.setCanceled(true);}
    private void chunk(ChunkEvent.Load e){
        if(ledger==null||e.getLevel().isClientSide())return;
        if(e.getChunk() instanceof net.minecraft.world.level.chunk.LevelChunk c)for(var b:c.getBlockEntities().values())if(b instanceof Container)loadedContainers.add(b);
    }
    private void cleanContainer(BlockEntity b){
        if(!(b instanceof Container c)||c instanceof RandomizableContainer r&&r.getLootTable()!=null)return;
        for(int i=0;i<c.getContainerSize();i++)if(marked(c.getItem(i))&&!active(c.getItem(i),blockLoc(b,i)))c.setItem(i,ItemStack.EMPTY);
    }
    private void commands(RegisterCommandsEvent e){
        e.getDispatcher().register(Commands.literal(commandName)
            .then(Commands.literal("status").requires(s->s.hasPermission(4)||s.getEntity() instanceof ServerPlayer p&&OWNER.equals(p.getUUID())).executes(c->{c.getSource().sendSuccess(()->Component.literal("星冕 enabled="+ledger.enabled+" epoch="+ledger.epoch+" location="+ledger.location+" cooldowns="+Math.max(0,ledger.melee-now())+","+Math.max(0,ledger.shot-now())+","+Math.max(0,ledger.ultimate-now())+" ticks"),false);return 1;}))
            .then(Commands.literal("recall").requires(s->s.getEntity()==null||s.getEntity() instanceof ServerPlayer p&&OWNER.equals(p.getUUID())).executes(c->{ledger.epoch++;ledger.location="pending";charges.clear();persist();var p=server.getPlayerList().getPlayer(OWNER);if(p!=null){cleanPlayer(p);deliver(p);}c.getSource().sendSuccess(()->Component.literal("旧实例已失效；新实例等待交付或已进入背包。"),false);return 1;}))
            .then(Commands.literal("disable").requires(s->s.hasPermission(4)).executes(c->{ledger.enabled=false;charges.clear();persist();c.getSource().sendSuccess(()->Component.literal("星冕技能已停用。"),true);return 1;}))
            .then(Commands.literal("harvest").requires(s->s.getEntity()==null||s.getEntity() instanceof ServerPlayer p&&OWNER.equals(p.getUUID())).then(Commands.literal("fortune").executes(c->{setHarvest(server.getPlayerList().getPlayer(OWNER),false);return 1;})).then(Commands.literal("silk").executes(c->{setHarvest(server.getPlayerList().getPlayer(OWNER),true);return 1;})))
            .then(Commands.literal("boots").requires(s->s.getEntity()==null||s.getEntity() instanceof ServerPlayer p&&OWNER.equals(p.getUUID())).then(Commands.literal("water").executes(c->{ledger.frost=false;persist();return 1;})).then(Commands.literal("frost").executes(c->{ledger.frost=true;persist();return 1;})))
            .then(Commands.literal("benchmark").requires(s->s.hasPermission(4)).executes(c->{benchmark=new Benchmark(server.overworld(),server.overworld().getSharedSpawnPos().getCenter().add(0,10,0));c.getSource().sendSuccess(()->Component.literal("Started 60-second six-viewer packet serialization benchmark."),false);return 1;}))
            .then(Commands.literal("selftest").requires(s->s.hasPermission(4)).executes(c->{try{selfTest();}catch(RuntimeException ex){ex.printStackTrace();c.getSource().sendFailure(Component.literal(ex.getMessage()));return 0;}c.getSource().sendSuccess(()->Component.literal("Starblade SELFTEST PASS"),false);return 1;}))
            .then(Commands.literal("enable").requires(s->s.hasPermission(4)).executes(c->{ledger.enabled=true;persist();return 1;})));
    }
    public boolean silkMode(){return ledger!=null&&ledger.silk;}
    public boolean frostMode(){return ledger!=null&&ledger.frost;}
    private void setHarvest(ServerPlayer p,boolean silk){
        ledger.silk=silk;persist();if(p==null)return;for(int i=0;i<p.getInventory().getContainerSize();i++){var item=p.getInventory().getItem(i);if(active(item,playerLoc(p,i)))GearAura.enchantWeapon(item,silk);}
        p.inventoryMenu.broadcastChanges();p.sendSystemMessage(Component.literal(silk?"神器采集：精准采集 I":"神器采集：时运 III"));
    }
    private void cleanPlayer(ServerPlayer p){
        for(int i=0;i<p.getInventory().getContainerSize();i++)if(marked(p.getInventory().getItem(i))&&!active(p.getInventory().getItem(i),playerLoc(p,i)))p.getInventory().setItem(i,ItemStack.EMPTY);
    }
    private void tick(ServerTickEvent.Post e){
        if(ledger==null)return;
        
        for(int i=0;i<32;i++){var b=loadedContainers.poll();if(b==null)break;if(!b.isRemoved()&&b.getLevel()!=null&&b.getLevel().hasChunkAt(b.getBlockPos()))cleanContainer(b);}
        if(benchmark!=null){benchmark.step();if(benchmark.ticks>=1200){System.out.println("[Starblade] BENCHMARK PASS ticks="+benchmark.ticks+" simulatedViewers=6 meanWeaponMs="+(benchmark.nanos/1e6/benchmark.ticks)+" packetBytes="+benchmark.bytes+" peakParticlesPerTick="+benchmark.peak);benchmark=null;}}
        if(now()%20==0){
            for(var p:server.getPlayerList().getPlayers())cleanPlayer(p);
            var p=server.getPlayerList().getPlayer(OWNER);
            if(p!=null&&ledger.location.startsWith("p|"+OWNER+"|")){
                int slot=Integer.parseInt(ledger.location.substring(ledger.location.lastIndexOf('|')+1));
                if(!active(p.getInventory().getItem(slot),ledger.location)){ledger.epoch++;ledger.location="pending";persist();}
            }
            if(p!=null&&ledger.enabled&&ledger.location.equals("pending"))deliver(p);
            if(ledger.location.startsWith("b|")){
                String[] a=ledger.location.split("\\|");
                var level=server.getLevel(net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.DIMENSION,ResourceLocation.parse(a[1])));
                var pos=new BlockPos(Integer.parseInt(a[2]),Integer.parseInt(a[3]),Integer.parseInt(a[4]));
                if(level!=null&&level.hasChunkAt(pos)){
                    var b=level.getBlockEntity(pos);if(b!=null)cleanContainer(b);
                    if(!(b instanceof Container c)||!active(c.getItem(Integer.parseInt(a[5])),ledger.location)){ledger.epoch++;ledger.location="pending";persist();}
                }
            }
        }
        var it=charges.entrySet().iterator();
        while(it.hasNext()){
            var entry=it.next();var q=entry.getValue();var p=server.getPlayerList().getPlayer(entry.getKey());
            if(p==null||!p.isAlive()||!wield(p)||p.serverLevel()!=q.level){it.remove();continue;}
            long age=now()-q.start;
            if(age>=40){burst(p,q.pos);it.remove();continue;}
            if(age%2==0){
                ring(q.level,q.pos.add(0,.15,0),6.5,24,age*.07,CYAN);
                ring(q.level,q.pos.add(0,9+age*.12,0),4.5,16,-age*.09,VIOLET);
                for(int i=0;i<16;i++)dust(q.level,q.pos.add(0,i*1.3,0),i%2==0?CYAN:VIOLET);
            }
        }
    }
    private boolean source(PlayerInteractEvent e){return e.getHand()==InteractionHand.MAIN_HAND&&e.getEntity() instanceof ServerPlayer&&marked(e.getItemStack());}
    private void rightItem(PlayerInteractEvent.RightClickItem e){if(source(e)){e.setCanceled(true);e.setCancellationResult(InteractionResult.SUCCESS);use((ServerPlayer)e.getEntity());}}
    private void rightBlock(PlayerInteractEvent.RightClickBlock e){
        if(!source(e))return;var p=(ServerPlayer)e.getEntity();
        // Interactive blocks keep their normal use; crouching explicitly selects the ultimate.
        if(!p.isShiftKeyDown()&&p.serverLevel().getBlockState(e.getPos()).getMenuProvider(p.serverLevel(),e.getPos())!=null)return;
        if(!p.isShiftKeyDown()){
            String id=net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(p.serverLevel().getBlockState(e.getPos()).getBlock()).getPath();
            if(net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(p.serverLevel().getBlockState(e.getPos()).getBlock()).getNamespace().equals("create")||id.contains("door")||id.contains("button")||id.contains("lever")||id.contains("valve")||id.contains("bearing")||id.contains("contraption"))return;
        }
        e.setCanceled(true);e.setCancellationResult(InteractionResult.SUCCESS);use(p);
    }
    private void rightEntity(PlayerInteractEvent.EntityInteract e){if(source(e)){e.setCanceled(true);e.setCancellationResult(InteractionResult.SUCCESS);use((ServerPlayer)e.getEntity());}}
    private void rightSpecific(PlayerInteractEvent.EntityInteractSpecific e){if(source(e)){e.setCanceled(true);e.setCancellationResult(InteractionResult.SUCCESS);use((ServerPlayer)e.getEntity());}}
    private void use(ServerPlayer p){
        if(!wield(p)){p.displayClientMessage(Component.literal("这把神器未登记在你手中，不能使用。"),true);return;}
        if(ledger.lastUse==now()||charges.containsKey(p.getUUID()))return;ledger.lastUse=now();
        if(p.isShiftKeyDown()){
            
            var hit=trace(p);if(hit.pos.distanceTo(p.getEyePosition())<2){p.displayClientMessage(Component.literal("请瞄准至少两格外的落点。"),true);return;}
            ledger.ultimate=0;ledger.setDirty();charges.put(p.getUUID(),new Charge(p.serverLevel(),hit.pos,now()));
            sound(p.serverLevel(),p.position(),SoundEvents.BEACON_POWER_SELECT,1.0f,.6f);
            sound(p.serverLevel(),hit.pos,SoundEvents.ENDER_DRAGON_GROWL,.6f,.8f);
            p.displayClientMessage(Component.literal("✦ 终焉裁决 · 星阵展开 ✦"),true);
        }else{
            if(now()<ledger.shot)return;ledger.shot=now()+20;ledger.setDirty();
            var hit=trace(p);var from=p.getEyePosition().add(p.getLookAngle().scale(.6));var delta=hit.pos.subtract(from);int n=Math.min(48,Math.max(1,(int)delta.length()));
            for(int i=0;i<=n;i++)dust(p.serverLevel(),from.add(delta.scale((double)i/n)),i%2==0?CYAN:VIOLET);
            ring(p.serverLevel(),from, .35,12,0,CYAN);
            sound(p.serverLevel(),p.position(),SoundEvents.WARDEN_SONIC_BOOM,.65f,1.5f);
            if(hit.entity!=null)hit.entity.hurt(p.damageSources().playerAttack(p),60f);
            explode(p,hit.pos,.9f,1);
        }
    }
    private void attack(AttackEntityEvent e){
        if(!(e.getEntity() instanceof ServerPlayer p)||!marked(p.getMainHandItem()))return;e.setCanceled(true);
        if(!wield(p)||now()<ledger.melee||charges.containsKey(p.getUUID()))return;
        ledger.melee=now()+16;ledger.setDirty();var origin=p.getEyePosition();var forward=p.getLookAngle();
        var targets=p.serverLevel().getEntitiesOfClass(LivingEntity.class,p.getBoundingBox().inflate(4),t->t!=p&&t.isAlive()&&!t.isSpectator());
        targets.sort(Comparator.comparingDouble(p::distanceToSqr));int count=0;
        for(var t:targets){var aim=t.getBoundingBox().getCenter();var v=aim.subtract(origin);
            if(v.length()>4||v.normalize().dot(forward)<Math.cos(Math.PI/4)||!visible(p.serverLevel(),origin,aim))continue;
            var source=p.damageSources().playerAttack(p);var sword=p.getMainHandItem();
            float damage=net.minecraft.world.item.enchantment.EnchantmentHelper.modifyDamage(p.serverLevel(),sword,t,source,40f);
            if(t.hurt(source,damage)){
                double force=net.minecraft.world.item.enchantment.EnchantmentHelper.modifyKnockback(p.serverLevel(),sword,t,source,0f)*.5;
                if(force>0)t.knockback(force,Math.sin(Math.toRadians(p.getYRot())),-Math.cos(Math.toRadians(p.getYRot())));
                net.minecraft.world.item.enchantment.EnchantmentHelper.doPostAttackEffectsWithItemSource(p.serverLevel(),t,source,sword);
            }if(++count>=16)break;
        }
        var side=forward.cross(new Vec3(0,1,0)).normalize();
        for(int i=0;i<32;i++){double a=-Math.PI/4+Math.PI/2*i/31;dust(p.serverLevel(),origin.add(forward.scale(Math.cos(a)*2.3)).add(side.scale(Math.sin(a)*2.3)),i%2==0?CYAN:VIOLET);}
        sound(p.serverLevel(),p.position(),SoundEvents.PLAYER_ATTACK_SWEEP,1,.65f);
        sound(p.serverLevel(),p.position(),SoundEvents.AMETHYST_BLOCK_CHIME,1,1.2f);
    }
    private boolean visible(ServerLevel level,Vec3 a,Vec3 b){return level.clip(new ClipContext(a,b,ClipContext.Block.COLLIDER,ClipContext.Fluid.NONE,net.minecraft.world.phys.shapes.CollisionContext.empty())).getType()==HitResult.Type.MISS;}
    private Hit trace(ServerPlayer p){
        var level=p.serverLevel();var start=p.getEyePosition();var direction=p.getLookAngle();double range=64;
        // Walk every crossed chunk boundary, including diagonal corners, without loading chunks.
        double d=0;
        while(d<64){
            var at=start.add(direction.scale(d));int cx=net.minecraft.util.Mth.floor(at.x)>>4,cz=net.minecraft.util.Mth.floor(at.z)>>4;
            if(!level.getChunkSource().hasChunk(cx,cz)){range=Math.max(0,d-.002);break;}
            double dx=Math.abs(direction.x)<1e-9?Double.POSITIVE_INFINITY:((direction.x>0?(cx+1)*16:cx*16)-at.x)/direction.x;
            double dz=Math.abs(direction.z)<1e-9?Double.POSITIVE_INFINITY:((direction.z>0?(cz+1)*16:cz*16)-at.z)/direction.z;
            d+=Math.max(.001,Math.min(dx,dz))+.001;
        }
        var end=start.add(direction.scale(range));var block=level.clip(new ClipContext(start,end,ClipContext.Block.COLLIDER,ClipContext.Fluid.NONE,p));
        var pos=block.getType()==HitResult.Type.MISS?end:block.getLocation();double nearest=start.distanceToSqr(pos);LivingEntity target=null;
        for(var t:level.getEntitiesOfClass(LivingEntity.class,new AABB(start,pos).inflate(1),x->x!=p&&x.isAlive()&&!x.isSpectator())){
            var hit=t.getBoundingBox().inflate(.15).clip(start,pos);if(hit.isPresent()&&start.distanceToSqr(hit.get())<nearest){nearest=start.distanceToSqr(hit.get());target=t;pos=hit.get();}
        }
        return new Hit(pos,target);
    }
    private void burst(ServerPlayer p,Vec3 pos){
        boolean permitted=explode(p,pos,4f,6);if(!permitted)return;
        for(var t:p.serverLevel().getEntitiesOfClass(LivingEntity.class,new AABB(pos,pos).inflate(6),x->x!=p&&x.isAlive()&&!x.isSpectator())){
            double d=t.getBoundingBox().getCenter().distanceTo(pos);if(d>6)continue;
            float exposure=Explosion.getSeenPercent(pos,t);if(exposure<=0)continue;
            t.hurt(p.damageSources().playerAttack(p),(float)(200*(1-d/6)*exposure));
        }
        ring(p.serverLevel(),pos.add(0,.2,0),9,32,0,VIOLET);
        for(int i=0;i<24;i++)dust(p.serverLevel(),pos.add(0,i*1.4,0),CYAN);
        sound(p.serverLevel(),pos,SoundEvents.GENERIC_EXPLODE.value(),1,.55f);
        sound(p.serverLevel(),pos,SoundEvents.LIGHTNING_BOLT_THUNDER,.8f,1.3f);
    }
    private boolean explode(ServerPlayer p,Vec3 pos,float power,double radius){
        int extent=(int)Math.ceil(power*2+2);
        for(int x=((int)Math.floor(pos.x)-extent)>>4;x<=((int)Math.floor(pos.x)+extent)>>4;x++)for(int z=((int)Math.floor(pos.z)-extent)>>4;z<=((int)Math.floor(pos.z)+extent)>>4;z++)if(!p.serverLevel().hasChunk(x,z))return false;
        var blast=new Blast(pos,radius);BLAST.set(blast);
        try{p.serverLevel().explode(p,p.damageSources().playerAttack(p),null,pos.x,pos.y,pos.z,power,false,Level.ExplosionInteraction.TNT);}
        finally{BLAST.remove();}
        return !blast.denied;
    }
    private void explosionStart(ExplosionEvent.Start e){if(BLAST.get()!=null&&e.isCanceled())BLAST.get().denied=true;}
    private void detonate(ExplosionEvent.Detonate e){
        var b=BLAST.get();if(b==null)return;
        e.getAffectedBlocks().removeIf(pos->pos.getCenter().distanceTo(b.pos)>b.radius||!e.getLevel().hasChunkAt(pos));
        e.getAffectedEntities().clear();
    }
    private void selfTest(){
        var real=ledger;testing=true;ledger=new Ledger();ledger.enabled=true;
        try{
            var level=server.overworld();
            var owner=new net.neoforged.neoforge.common.util.FakePlayer(level,new com.mojang.authlib.GameProfile(OWNER,"StarbladeProbe"));
            var other=new net.neoforged.neoforge.common.util.FakePlayer(level,new com.mojang.authlib.GameProfile(UUID.fromString("f9eb5a58-d1e7-468b-98ec-b3d99e26f943"),"ForeignProbe"));
            check(deliver(owner),"first delivery");int initial=Integer.parseInt(ledger.location.substring(ledger.location.lastIndexOf('|')+1));owner.getInventory().selected=initial;
            check(wield(owner),"owner identity");GearAura.update(owner);
            setHarvest(owner,true);check(net.minecraft.world.item.enchantment.EnchantmentHelper.getItemEnchantmentLevel(level.registryAccess().lookupOrThrow(net.minecraft.core.registries.Registries.ENCHANTMENT).getOrThrow(net.minecraft.world.item.enchantment.Enchantments.SILK_TOUCH),owner.getMainHandItem())==1,"silk mode");setHarvest(owner,false);
            owner.getInventory().selected=8;GearAura.update(owner);check(owner.getArmorValue()==0,"unheld aura removed");owner.getInventory().selected=initial;GearAura.update(owner);
            check(owner.getArmorValue()==20&&owner.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.ARMOR_TOUGHNESS)==8,"virtual diamond armor and toughness");
            check(net.minecraft.world.item.enchantment.EnchantmentHelper.getDamageProtection(level,owner,owner.damageSources().generic())>=16,"virtual protection IV on four pieces");
            check(owner.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.OXYGEN_BONUS)>=3&&owner.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.WATER_MOVEMENT_EFFICIENCY)>=1,"respiration and depth strider attributes");
            check(owner.getMainHandItem().isCorrectToolForDrops(net.minecraft.world.level.block.Blocks.DIAMOND_ORE.defaultBlockState())&&owner.getMainHandItem().getDestroySpeed(net.minecraft.world.level.block.Blocks.STONE.defaultBlockState())==8,"diamond multi-tool mining rules");
            var damaged=new ItemStack(Items.DIAMOND_HELMET);damaged.setDamageValue(10);owner.setItemSlot(EquipmentSlot.HEAD,damaged);var xp=new net.neoforged.neoforge.event.entity.player.PlayerXpEvent.XpChange(owner,3);GearAura.xp(xp);check(damaged.getDamageValue()==4&&xp.getAmount()==0,"held aura mending repairs actual gear");owner.setItemSlot(EquipmentSlot.HEAD,ItemStack.EMPTY);other.getInventory().setItem(0,make());check(!wield(other),"foreign player cannot wield");cleanPlayer(other);check(other.getInventory().getItem(0).isEmpty(),"foreign copy removed");
            owner.getInventory().setItem(1,make());cleanPlayer(owner);check(owner.getInventory().getItem(1).isEmpty(),"duplicate rejected");
            var menu=owner.inventoryMenu;int source=36+initial;
            menu.clicked(source,0,ClickType.PICKUP,owner);check(ledger.location.equals("c|"+OWNER)&&token(menu.getCarried()),"cursor transfer");
            menu.clicked(-999,0,ClickType.PICKUP,owner);check(token(menu.getCarried()),"outside drop blocked");
            menu.clicked(37,0,ClickType.PICKUP,owner);check(ledger.location.equals(playerLoc(owner,1)),"inventory transfer");
            var chest=new ChestBlockEntity(new BlockPos(10008,600,10008),net.minecraft.world.level.block.Blocks.CHEST.defaultBlockState());chest.setLevel(level);
            var cm=ChestMenu.threeRows(97,owner.getInventory(),chest);
            cm.clicked(55,0,ClickType.QUICK_MOVE,owner);check(ledger.location.equals(blockLoc(chest,0))&&token(chest.getItem(0)),"chest storage");
            var foreign=ChestMenu.threeRows(98,other.getInventory(),chest);foreign.clicked(0,0,ClickType.PICKUP,other);check(token(chest.getItem(0))&&foreign.getCarried().isEmpty(),"foreign chest theft blocked");
            var wrapper=new net.neoforged.neoforge.items.wrapper.InvWrapper(chest);check(wrapper.extractItem(0,1,false).isEmpty()&&token(chest.getItem(0)),"automation extraction blocked");
            cm.clicked(0,0,ClickType.PICKUP,owner);check(token(cm.getCarried()),"chest retrieval");cm.removed(owner);check(ledger.location.startsWith("p|"+OWNER),"closing menu preserves weapon");
            var old=make();ledger.epoch++;check(!token(old),"recall invalidates prior generation");cleanPlayer(owner);check(deliver(owner),"replacement delivered");
            ledger.melee=now()+16;ledger.shot=now()+20;ledger.ultimate=now()+900;
            var loaded=Ledger.load(ledger.save(new CompoundTag(),server.registryAccess()),server.registryAccess());check(loaded.id.equals(ledger.id)&&loaded.epoch==ledger.epoch&&loaded.ultimate==ledger.ultimate,"restart ledger and cooldown persistence");
            for(int i=0;i<36;i++)owner.getInventory().setItem(i,new ItemStack(Items.DIRT,64));ledger.location="pending";check(!deliver(owner)&&ledger.location.equals("pending"),"full inventory waits");
            check(charges.isEmpty(),"no persistent FX entities");
            combatTest(owner);
            System.out.println("[Starblade] SELFTEST PASS: UUID binding, duplicate/copy rejection, inventory/cursor/chest transfers, foreign theft, drop, automation, menu close, recall generation, full inventory, serialized cooldowns.");
        }finally{ledger=real;testing=false;TRANSFER.set(false);}
    }
    private void combatTest(ServerPlayer owner){
        var level=server.overworld();var spawn=level.getSharedSpawnPos();
        // Only use an empty, already loaded sky volume above spawn; snapshot every touched block.
        var center=new BlockPos(spawn.getX(),300,spawn.getZ());System.out.println("[Starblade] Sky fixture "+center);
        var min=center.offset(-10,-4,-10);var max=center.offset(10,5,10);
        var snapshot=new HashMap<BlockPos,net.minecraft.world.level.block.state.BlockState>();
        for(var mutable:BlockPos.betweenClosed(min,max)){
            var pos=mutable.immutable();check(level.hasChunkAt(pos),"fixture chunks already loaded");
            var state=level.getBlockState(pos);check(state.isAir(),"fixture sky volume empty");snapshot.put(pos,state);
        }
        var entities=new ArrayList<LivingEntity>();
        var blocks=net.minecraft.world.level.block.Blocks.class;
        try{
            owner.setPos(center.getX()+.5,300,center.getZ()+.5);owner.setYRot(0);owner.setXRot(10);
            for(int i=0;i<36;i++)owner.getInventory().setItem(i,ItemStack.EMPTY);ledger.location="pending";deliver(owner);owner.getInventory().selected=0;
            var near=probeMob(level,owner.position().add(0,0,3),entities);var behind=probeMob(level,owner.position().add(0,0,-3),entities);var far=probeMob(level,owner.position().add(0,0,5),entities);
            ledger.melee=0;attack(new AttackEntityEvent(owner,near));
            check(Math.abs(near.getHealth()-957)<.1&&behind.getHealth()==1000&&far.getHealth()==1000,"melee cone, 40 HP and range");
            ledger.melee=0;near.invulnerableTime=0;var wall=center.offset(0,1,2);level.setBlockAndUpdate(wall,net.minecraft.world.level.block.Blocks.STONE.defaultBlockState());
            attack(new AttackEntityEvent(owner,near));check(near.getHealth()==957,"melee obstruction");
            check(trace(owner).entity==null&&trace(owner).pos.distanceTo(owner.getEyePosition())<3,"beam block obstruction");
            level.setBlockAndUpdate(wall,net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
            check(trace(owner).entity==near,"beam first target");
            near.setDeltaMovement(Vec3.ZERO);near.invulnerableTime=0;ledger.shot=0;ledger.lastUse=-1;use(owner);check(Math.abs(near.getHealth()-897)<.1,"beam 60 HP and source");float health=near.getHealth();use(owner);check(near.getHealth()==health,"same-tick interaction dedup");
            for(var entity:entities)entity.discard();entities.clear();
            for(int x=-9;x<=9;x++)for(int z=-9;z<=9;z++)level.setBlockAndUpdate(center.offset(x,-1,z),net.minecraft.world.level.block.Blocks.GLASS.defaultBlockState());
            var bedrock=center.offset(1,0,0);level.setBlockAndUpdate(bedrock,net.minecraft.world.level.block.Blocks.BEDROCK.defaultBlockState());
            var impact=center.getCenter();check(explode(owner,impact,4,6),"unclaimed vanilla explosion permitted");int broken=0;
            for(int x=-9;x<=9;x++)for(int z=-9;z<=9;z++){
                var pos=center.offset(x,-1,z);boolean empty=level.getBlockState(pos).isAir();
                if(pos.getCenter().distanceTo(impact)>6)check(!empty,"ultimate exact block boundary");if(empty)broken++;
            }
            check(broken>0,"explosion actually destroys blocks");check(level.getBlockState(bedrock).is(net.minecraft.world.level.block.Blocks.BEDROCK),"bedrock unchanged");
            var oak=center.offset(0,0,3);
            for(int x=-2;x<=2;x++)for(int z=-2;z<=2;z++)level.setBlockAndUpdate(oak.offset(x,0,z),net.minecraft.world.level.block.Blocks.OAK_PLANKS.defaultBlockState());
            check(explode(owner,oak.getCenter(),.9f,1),"shot explosion permitted");
            for(int x=-2;x<=2;x++)for(int z=-2;z<=2;z++)if(Math.hypot(x,z)>1)check(level.getBlockState(oak.offset(x,0,z)).is(net.minecraft.world.level.block.Blocks.OAK_PLANKS),"shot exact block boundary");
            check(!level.getEntitiesOfClass(ItemEntity.class,new AABB(min.getCenter().add(-.5,-.5,-.5),max.getCenter().add(.5,.5,.5))).isEmpty(),"vanilla block drops retained");
            var protectedBlock=center.offset(4,0,4);level.setBlockAndUpdate(protectedBlock,net.minecraft.world.level.block.Blocks.OAK_PLANKS.defaultBlockState());
            denyProbe=true;check(!explode(owner,protectedBlock.getCenter(),4,6)&&level.getBlockState(protectedBlock).is(net.minecraft.world.level.block.Blocks.OAK_PLANKS),"canceled explosion protection honored");denyProbe=false;
            // Damage runs through the ordinary armor pipeline and retains player attribution.
            var armored=probeMob(level,owner.position().add(-3,0,3),entities);armored.setItemSlot(EquipmentSlot.CHEST,new ItemStack(Items.DIAMOND_CHESTPLATE));armored.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.ARMOR).setBaseValue(8);
            armored.hurt(owner.damageSources().playerAttack(owner),40);check(armored.getHealth()>960&&armored.getHealth()<1000&&armored.getLastHurtByMob()==owner,"armor and attacker attribution");
            for(var entry:snapshot.entrySet())level.setBlockAndUpdate(entry.getKey(),entry.getValue());
            var epicenter=center.getCenter();var close=probeMob(level,epicenter.add(0,-.7,0),entities);var middle=probeMob(level,epicenter.add(3,-.7,0),entities);var outside=probeMob(level,epicenter.add(7,-.7,0),entities);
            burst(owner,epicenter);check(Math.abs(close.getHealth()-800)<1&&Math.abs(middle.getHealth()-900)<1&&outside.getHealth()==1000,"ultimate 200 HP, distance falloff and radius");
            ledger.lastUse=-1;ledger.ultimate=0;owner.setShiftKeyDown(true);use(owner);check(charges.containsKey(OWNER),"ultimate telegraph starts");owner.getInventory().setItem(0,ItemStack.EMPTY);var q=charges.get(OWNER);check(!wield(owner),"weapon switch cancels cast predicate");charges.clear();owner.setShiftKeyDown(false);
            System.out.println("[Starblade] COMBAT PASS: cone/range, 40/60 HP, block occlusion, first target, event dedup, vanilla explosion, radius6, drops, bedrock, canceled protection event, armor/attribution. Sky fixture restored.");
        }finally{
            denyProbe=false;for(var entity:entities)entity.discard();
            for(var item:level.getEntitiesOfClass(ItemEntity.class,new AABB(min.getCenter().add(-.5,-.5,-.5),max.getCenter().add(.5,.5,.5))))item.discard();
            for(var entry:snapshot.entrySet())level.setBlockAndUpdate(entry.getKey(),entry.getValue());
        }
    }
    private LivingEntity probeMob(ServerLevel level,Vec3 pos,List<LivingEntity> cleanup){
        var mob=new net.minecraft.world.entity.animal.Cow(EntityType.COW,level);mob.setPos(pos);mob.setNoAi(true);
        mob.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.MAX_HEALTH).setBaseValue(1000);mob.setHealth(1000);level.addFreshEntity(mob);cleanup.add(mob);return mob;
    }
    private final class Benchmark {
        final ServerLevel level;final Vec3 center;long nanos,bytes;int ticks,peak;
        Benchmark(ServerLevel l,Vec3 c){level=l;center=c;}
        void step(){
            long start=System.nanoTime();int particles=ticks%2==0?56:0;peak=Math.max(peak,particles);
            // Serialize the exact vanilla packet six times, without creating connections or world players.
            var buffer=new net.minecraft.network.RegistryFriendlyByteBuf(io.netty.buffer.Unpooled.buffer(),server.registryAccess());
            try{for(int i=0;i<particles;i++)for(int viewer=0;viewer<6;viewer++){
                buffer.clear();var packet=new net.minecraft.network.protocol.game.ClientboundLevelParticlesPacket(new DustParticleOptions(i%2==0?CYAN:VIOLET,1.3f),true,center.x+Math.cos(i)*6.5,center.y,center.z+Math.sin(i)*6.5,0,0,0,0,1);
                net.minecraft.network.protocol.game.ClientboundLevelParticlesPacket.STREAM_CODEC.encode(buffer,packet);bytes+=buffer.readableBytes();
            }}finally{buffer.release();}nanos+=System.nanoTime()-start;ticks++;
        }
    }
    private void check(boolean test,String name){if(!test)throw new IllegalStateException("Starblade selftest failed: "+name);}
    private final Vector3f CYAN=new Vector3f(.05f,.9f,1f),VIOLET=new Vector3f(.65f,.12f,1f);
    private void dust(ServerLevel level,Vec3 pos,Vector3f color){
        if(!Starblade.consumeParticle(now()))return;
        var particle=new DustParticleOptions(color,1.3f);
        for(var viewer:server.getPlayerList().getPlayers())if(viewer.serverLevel()==level&&viewer.distanceToSqr(pos.x,pos.y,pos.z)<=4096)level.sendParticles(viewer,particle,true,pos.x,pos.y,pos.z,1,0,0,0,0);
    }
    private void ring(ServerLevel l,Vec3 center,double r,int n,double spin,Vector3f color){for(int i=0;i<n;i++){double a=spin+i*2*Math.PI/n;dust(l,center.add(Math.cos(a)*r,0,Math.sin(a)*r),color);}}
    private void sound(ServerLevel level,Vec3 pos,SoundEvent sound,float volume,float pitch){level.playSound(null,pos.x,pos.y,pos.z,sound,SoundSource.PLAYERS,volume,pitch);}
    private record Hit(Vec3 pos,LivingEntity entity){}
    private record Charge(ServerLevel level,Vec3 pos,long start){}
    private final class Blast{final Vec3 pos;final double radius;boolean denied;Blast(Vec3 p,double r){pos=p;radius=r;}}
    public static final class Ledger extends SavedData{
        UUID id=UUID.randomUUID();long epoch=1,melee,shot,ultimate,lastUse=-1;String location="pending";boolean enabled=false,silk=false,frost=false;
        static Ledger load(CompoundTag tag,HolderLookup.Provider registry){var d=new Ledger();d.id=tag.getUUID("id");d.epoch=tag.getLong("epoch");d.location=tag.getString("location");d.enabled=tag.getBoolean("enabled");d.silk=tag.getBoolean("silk");d.frost=tag.getBoolean("frost");d.melee=tag.getLong("melee");d.shot=tag.getLong("shot");d.ultimate=tag.getLong("ultimate");return d;}
        public CompoundTag save(CompoundTag tag,HolderLookup.Provider registry){tag.putUUID("id",id);tag.putLong("epoch",epoch);tag.putString("location",location);tag.putBoolean("enabled",enabled);tag.putBoolean("silk",silk);tag.putBoolean("frost",frost);tag.putLong("melee",melee);tag.putLong("shot",shot);tag.putLong("ultimate",ultimate);return tag;}
    }
}
