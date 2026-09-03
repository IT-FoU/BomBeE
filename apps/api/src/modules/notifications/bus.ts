export type NotificationChannel = 'in_app' | 'sms' | 'email';

export type NotificationMessage = {
  channel: NotificationChannel;
  toIdentityId?: string;
  toRole?: 'owner';
  template: string;
  payload: Record<string, unknown>;
};

export class NotificationBus {
  readonly messages: NotificationMessage[] = [];

  async publish(message: NotificationMessage): Promise<void> {
    this.messages.push(message);
  }

  async notifyOwnerNewDevice(input: {
    staffIdentityId: string;
    deviceId: string;
    fingerprint: string;
  }): Promise<void> {
    await this.publish({
      channel: 'in_app',
      toRole: 'owner',
      template: 'staff.new_device',
      payload: input,
    });
  }

  async notifyAllSessions(input: {
    authIdentityId: string;
    sessionId: string;
    deviceId?: string;
  }): Promise<void> {
    await this.publish({
      channel: 'in_app',
      toIdentityId: input.authIdentityId,
      template: 'session.created',
      payload: input,
    });
  }
}
