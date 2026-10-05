import {useRef} from 'react';
import {VrmStage,createBus,type StageStatus} from './AvatarStage';
import {LipSync} from '@/lib/avatarLipSync';
import type {ModelSource} from '@/lib/avatarModels';
export default function CompanionStage({source,night,onStatus}:{source:ModelSource;night:boolean;onStatus:(status:StageStatus)=>void}){
 const bus=useRef(createBus(new LipSync()));
 return <VrmStage source={source} bus={bus.current} camera="full" night={night} onStatus={onStatus} companion/>;
}
