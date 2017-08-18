import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';

import { IChromeInstance } from '../support/ChromeInstance';
import {
  PROCESS_WAITING_PERIOD, HEALTH_CHECK_PERIOD, PORTRAIT_RESOLUTION, INSTANCES_CHECKING_PERIOD
} from '../support/constants';

export class ChromeInstancesManager {

  private instancesActionEmitter = new EventEmitter();
  private instances: IChromeInstance[] = [
    {port: 9222, isIdle: true},
    {port: 9223, isIdle: true},
    {port: 9224, isIdle: true},
    {port: 9225, isIdle: true},
    {port: 9226, isIdle: true}
  ];
  private pendingQueue: Function[] = [];
  private chromiumBinary: any;
  private runningInstances = new Map<number, ChildProcess>();

  // contains timestamp of last activity related to instance. <port, timestamp>
  private activities = new Map<number, number>();

  // if false, connections will not be respawned after closing
  private keepConnectionsAlive: boolean = true;
  private logger: any;

  constructor(chromiumBinary: any, logger: any) {
    this.chromiumBinary = chromiumBinary;
    this.logger = logger;
    this.instances.forEach((item: IChromeInstance) => {
      this.runInstance(item.port);
    });

    this.instancesActionEmitter.on('change', (message: any) => {
      // stores activity related to port
      this.activities.set(message.port, new Date().getTime());
    });

    // check instances every <INSTANCES_CHECKING_PERIOD> ms
    setInterval(this.checkInstancesActivity.bind(this), INSTANCES_CHECKING_PERIOD);
  }

  public cloneInstancesState() {
    return JSON.parse(JSON.stringify(this.instances));
  }

  private runInstance(port: number) {
    const process = spawn(this.chromiumBinary, [
      '--headless',
      '--no-sandbox',
      `--remote-debugging-port=${port}`,
      `--window-size=${PORTRAIT_RESOLUTION}`,
      '--hide-scrollbars'
    ]);
    const msg = `Spawning instance on ${port} port, PID: ${process.pid}`;
    this.logger.info(msg);

    // associate port with process and set process's initial activity timestamp
    this.runningInstances.set(port, process);
    this.activities.set(port, new Date().getTime());

    process.on('exit', () => {
      this.logger.info('"Exit" event was been emitted');
      this.respawnInstances();
    });

    process.on('error', (err: any) => {
      this.logger.error('"Error" event was been emitted' + err.toString());
      this.respawnInstances();
    });
  }

  private respawnInstances() {
    if (!this.keepConnectionsAlive) {
      return;
    }

    this.runningInstances.forEach((value: any, key: number) => {
      if (value.killed) {
        this.runInstance(key);
      }
    });
  }

  // every <INSTANCES_CHECKING_PERIOD> ms, app will check instances, and if some was busy, greater than
  // <PROCESS_WAITING_PERIOD> ms - that processes will be destroyed
  private checkInstancesActivity() {
    const now = new Date().getTime();
    this.instances.forEach((instance: IChromeInstance) => {
      if (instance.isIdle) {
        return;
      }

      const actItem = this.activities.get(instance.port);
      if (actItem) {
        const busyTime = now - actItem;
        if (busyTime >= PROCESS_WAITING_PERIOD) {
          const msg = `Instance on port ${instance.port} is busy more than ${busyTime} ms and will been killed`;
          this.logger.warn(msg);
          this.killInstanceOn(instance.port);
        }
      }

      return;
    });
  }

  /**
   * Returns(callback) free idle chrome instance. If all instances is busy it will add pending callback to queue
   * also emits event, that instance status was been changed
   * @param {Function} cb
   */
  public getFreeInstance(cb: Function): void {
    const instance = this.instances.find((item: IChromeInstance, index: number) => {
      if (item.isIdle) {
        this.instancesActionEmitter.emit('change', {port: item.port, status: 'busy'});
        this.instances[index].isIdle = false;
        return true;
      }
      return false;
    });

    if (instance) {
      // return found free instance
      return cb(instance);
    }

    // free instance not found, add callback to queue(to tail)
    this.pendingQueue.push(cb);
  }

  /**
   * marks specified instance as idle. If pending queue is not empty will pass this instance to first item in queue
   * also emits event, that instance status was been changed
   * @param {IChromeInstance} instance
   * @returns {any}
   */
  public setInstanceAsIdle(instance: IChromeInstance) {
    this.instancesActionEmitter.emit('change', {port: instance.port, status: 'idle'});
    const index = this.instances.findIndex((item: any) => item.port === instance.port);
    this.instances[index].isIdle = true;
    if (this.pendingQueue.length === 0) {
      return;
    }

    // pull top pending callback and pass new freed instance to it. If queue is empty - do nothing
    const pendingItemCallback = this.pendingQueue.shift();
    if (pendingItemCallback) {
      this.instances[index].isIdle = false;
      this.instancesActionEmitter.emit('change', {port: instance.port, status: 'busy'});
      return pendingItemCallback(instance);
    }
  }

  /**
   * logs all instances activities for some time and returns log via callback
   * @param {String} version
   * @param {Function} cb
   */
  public healthCheck(version: string, cb: Function) {
    let outString: string [] = ['Service version: ' + version];
    const initialState = this.cloneInstancesState().map(formatResult);
    outString.push('Initial state:');
    outString = outString.concat(initialState);
    outString.push(' ');
    outString.push('Activity on 30 second', '---------------------');

    this.instancesActionEmitter.on('change', changed);

    function changed(message: {port: number, status: string}) {
      outString.push(`instance on port ${message.port} is sets to ${message.status}`);
    }

    setTimeout(() => {
      this.instancesActionEmitter.removeListener('free-connection', changed);

      const finalState = this.cloneInstancesState().map(formatResult);
      outString.push(' ', 'Final state:');
      outString = outString.concat(finalState);

      cb(outString.join('\r\n'));
    }, HEALTH_CHECK_PERIOD);

    function formatResult(item: IChromeInstance) {
      const status = item.isIdle ? 'is idle' : 'is busy';
      return `Port: ${item.port} is ${status}`;
    }
  }

  public killInstanceOn(port: number) {
    const instance = this.runningInstances.get(port);
    if (instance) {
      console.log(`Killing an instance, port: ${port}, PID: ${instance.pid}: `, instance.kill());
    }
  }

  /**
   * Will send to all chrome processes signal "exit"
   * @param {boolean} keepConnectionsAlive, if true will be created a new connection instead of killed, if false - not
   */
  public killInstances(keepConnectionsAlive: boolean) {
    this.keepConnectionsAlive = keepConnectionsAlive;
    this.runningInstances.forEach((value: ChildProcess, key: number) => {
      const isKilled = value.kill();
      const msg = `Process killed: PID ${value.pid}, port: ${key} -> ` + isKilled;
      this.logger.info(msg);
    });
  }

}