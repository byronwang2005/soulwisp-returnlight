package wang.byron.perks;

import java.util.*;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.simibubi.create.Create;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.trains.track.*;
import com.simibubi.create.content.trains.station.StationBlockEntity;
import com.simibubi.create.content.trains.schedule.Schedule;
import com.simibubi.create.content.trains.graph.EdgePointType;
import com.simibubi.create.content.contraptions.glue.SuperGlueEntity;
import net.createmod.catnip.data.Couple;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.TagParser;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.*;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/** Console/OP construction operations use Create's own graph, assembly and schedules. */
public final class RailOps {
 public static void register(){NeoForge.EVENT_BUS.addListener(RailOps::commands);}
 private static void commands(RegisterCommandsEvent event){
  event.getDispatcher().register(Commands.literal("railops").requires(s->s.hasPermission(4))
   .then(Commands.argument("operation",StringArgumentType.greedyString()).executes(c->{
    try{String result=run(c.getSource().getServer().overworld(),StringArgumentType.getString(c,"operation"));c.getSource().sendSuccess(()->Component.literal(result),false);return 1;}
    catch(Exception e){c.getSource().sendFailure(Component.literal("Rail operation failed: "+e));return 0;}
   })));
 }
 private static BlockPos pos(String[] a,int offset){return new BlockPos(Integer.parseInt(a[offset]),Integer.parseInt(a[offset+1]),Integer.parseInt(a[offset+2]));}
 private static void loaded(ServerLevel l,BlockPos p){if(!l.hasChunkAt(p))throw new IllegalArgumentException("Load the construction chunk first: "+p);}
 private static String run(ServerLevel l,String input)throws Exception{
  String[] a=input.split(" ");
  switch(a[0]){
   case "survey":{
    StringBuilder out=new StringBuilder("graphs="+Create.RAILWAYS.trackNetworks.size()+" trains="+Create.RAILWAYS.trains.size());
    for(var graph:Create.RAILWAYS.trackNetworks.values())for(var s:graph.getPoints(EdgePointType.STATION))out.append("\nstation ").append(s.name).append(" ").append(s.getBlockEntityPos());
    for(var t:Create.RAILWAYS.trains.values())out.append("\ntrain ").append(t.id).append(" ").append(t.name.getString()).append(" speed=").append(t.speed).append(" derailed=").append(t.derailed).append(" forwardDriver=").append(t.hasForwardConductor()).append(" backwardDriver=").append(t.hasBackwardConductor()).append(" navigationError=").append(t.status.navigation).append(" conductorError=").append(t.status.conductor).append(" entry=").append(t.runtime.currentEntry).append(" state=").append(t.runtime.state).append(" paused=").append(t.runtime.paused).append(" destination=").append(t.navigation.destination==null?"none":t.navigation.destination.name).append(" station=").append(t.getCurrentStation()==null?"none":t.getCurrentStation().name);
    return out.toString();
   }
   case "curve":{
    BlockPos p=pos(a,1),q=pos(a,4);loaded(l,p);loaded(l,q);
    Vec3 d=new Vec3(Double.parseDouble(a[7]),0,Double.parseDouble(a[8])),e=new Vec3(Double.parseDouble(a[9]),0,Double.parseDouble(a[10]));
    for(var b:List.of(p,q))if(!(l.getBlockState(b).getBlock() instanceof TrackBlock))throw new IllegalArgumentException("Expected track endpoint: "+b);
    l.setBlockAndUpdate(p,l.getBlockState(p).setValue(TrackBlock.HAS_BE,true));l.setBlockAndUpdate(q,l.getBlockState(q).setValue(TrackBlock.HAS_BE,true));
    var connection=new BezierConnection(Couple.create(p,q),Couple.create(Vec3.atBottomCenterOf(p).add(d.scale(.5)),Vec3.atBottomCenterOf(q).add(e.scale(.5))),Couple.create(d,e),Couple.create(new Vec3(0,1,0),new Vec3(0,1,0)),true,true,TrackMaterial.ANDESITE);
    ((TrackBlockEntity)l.getBlockEntity(p)).addConnection(connection);((TrackBlockEntity)l.getBlockEntity(q)).addConnection(connection.secondary());return "Curve connected "+p+" -> "+q;
   }
   case "disconnect":{
    BlockPos p=pos(a,1),q=pos(a,4);loaded(l,p);loaded(l,q);
    ((TrackBlockEntity)l.getBlockEntity(p)).removeConnection(q);((TrackBlockEntity)l.getBlockEntity(q)).removeConnection(p);return "Curve disconnected";
   }
   case "name":{
    BlockPos p=pos(a,1);loaded(l,p);var station=(StationBlockEntity)l.getBlockEntity(p);String name=input.substring(input.indexOf(a[4]));if(!station.updateName(name))throw new IllegalStateException("Station not registered yet");return "Station named "+name;
   }
   case "glue":{
    BlockPos p=pos(a,1),q=pos(a,4);loaded(l,p);loaded(l,q);var glue=new SuperGlueEntity(l,new AABB(Vec3.atLowerCornerOf(p),Vec3.atLowerCornerOf(q.offset(1,1,1))));glue.addTag("regional_rail_glue");l.addFreshEntity(glue);return "Carriage glued";
   }
   case "assemble":{
    BlockPos p=pos(a,1);loaded(l,p);var station=(StationBlockEntity)l.getBlockEntity(p);Set<UUID> before=new HashSet<>(Create.RAILWAYS.trains.keySet());
    station.enterAssemblyMode(null);station.refreshAssemblyInfo();station.assemble(Starblade.OWNER);
    var train=Create.RAILWAYS.trains.values().stream().filter(t->!before.contains(t.id)).findFirst().orElseThrow(()->new IllegalStateException("Create rejected carriage assembly; inspect station NBT"));
    station.exitAssemblyMode();train.name=Component.literal(a[4]);Create.RAILWAYS.markTracksDirty();return "Assembled "+train.id+" "+train.name.getString()+" doubleEnded="+train.doubleEnded;
   }
   case "schedule":{
    var train=Create.RAILWAYS.trains.get(UUID.fromString(a[1]));if(train==null)throw new IllegalArgumentException("Unknown train");String snbt=input.substring(input.indexOf('{'));train.runtime.setSchedule(Schedule.fromTag(l.registryAccess(),TagParser.parseTag(snbt)),true);Create.RAILWAYS.markTracksDirty();return "Automatic schedule installed";
   }
   case "route":{
    var train=Create.RAILWAYS.trains.get(UUID.fromString(a[1]));if(train==null)throw new IllegalArgumentException("Unknown train");
    StringBuilder tag=new StringBuilder("{Cyclic:1b,Entries:[");int count=0;
    for(String name:a[2].split("\\|")){
     if(count++>0)tag.append(',');
     tag.append("{Instruction:{Id:\"create:destination\",Data:{Text:").append(new com.google.gson.Gson().toJson(name)).append("}},Conditions:[[{Id:\"create:delay\",Data:{Value:20,TimeUnit:1}}]]}");
    }
    tag.append("]}");train.runtime.setSchedule(Schedule.fromTag(l.registryAccess(),TagParser.parseTag(tag.toString())),true);Create.RAILWAYS.markTracksDirty();return "Automatic route installed: "+count+" stops";
   }
   case "pause":{
    var train=Create.RAILWAYS.trains.get(UUID.fromString(a[1]));if(train==null)throw new IllegalArgumentException("Unknown train");train.runtime.paused=true;train.navigation.cancelNavigation();Create.RAILWAYS.markTracksDirty();return "Service paused";
   }
   default:throw new IllegalArgumentException("Operations: survey, curve, disconnect, name, glue, assemble, schedule, route, pause");
  }
 }
}
