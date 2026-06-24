import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { App } from './app';
import { AuthService } from './services/auth.service';
import { SeedService } from './services/seed.service';
import { ThemeService } from './services/theme.service';
import { BillService } from './services/bill.service';
import { QuickAddService } from './services/quick-add.service';
import { AutopayService } from './services/autopay.service';
import { EncryptionService } from './services/encryption.service';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  const authUser = signal<any>(null);
  const unlocked = signal(false);
  const hasProfile = signal<boolean | null>(null);
  const busy = signal(false);
  const encryptionError = signal<string | null>(null);
  const quickAddTrigger = vi.fn();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            user: authUser,
            signInWithGoogle: vi.fn(),
            signInWithEmail: vi.fn(),
            signUpWithEmail: vi.fn(),
            sendPasswordReset: vi.fn(),
            signOut: vi.fn(),
          },
        },
        { provide: SeedService, useValue: { seedIfEmpty: vi.fn() } },
        { provide: ThemeService, useValue: { theme: signal('light'), toggle: vi.fn() } },
        {
          provide: BillService,
          useValue: {
            overdueBills: vi.fn(() => []),
            upcomingBills: vi.fn(() => []),
            bills: signal([]),
          },
        },
        {
          provide: QuickAddService,
          useValue: {
            trigger: quickAddTrigger,
          },
        },
        { provide: AutopayService, useValue: { runIfNeeded: vi.fn() } },
        {
          provide: EncryptionService,
          useValue: {
            unlocked,
            hasProfile,
            busy,
            error: encryptionError,
            refreshProfileState: vi.fn(() => Promise.resolve()),
            migrateUserData: vi.fn(),
            unlock: vi.fn(),
            lock: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    authUser.set(null);
    unlocked.set(false);
    hasProfile.set(null);
    busy.set(false);
    encryptionError.set(null);
    quickAddTrigger.mockReset();
    fixture = TestBed.createComponent(App);
  });

  it('renders the email sign-in form for signed-out users', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Welcome back');
    expect(compiled.textContent).toContain('Sign in');
    expect(compiled.querySelector('input[type="email"]')).toBeTruthy();
  });

  it('shows the encryption unlock screen after authentication', () => {
    authUser.set({ email: 'user@example.com' });
    hasProfile.set(true);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Unlock encrypted data');
  });

  it('shows create vault copy for first-time encrypted users', () => {
    authUser.set({ email: 'user@example.com' });
    hasProfile.set(false);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Create encryption passphrase');
  });

  it('opens the command palette for unlocked users', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    fixture.detectChanges();

    fixture.componentInstance.openCommandPalette();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Add expense');
    expect(compiled.textContent).toContain('Go to Transactions');
    expect(compiled.querySelector('.command-input')).toBeTruthy();
  });

  it('opens quick add with single-key shortcuts for unlocked users', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    fixture.detectChanges();
    const quickAddSpy = vi.spyOn(fixture.componentInstance, 'quickAdd').mockImplementation(() => {});

    fixture.componentInstance.handleGlobalKeydown(new KeyboardEvent('keydown', { key: 'n' }));

    expect(quickAddSpy).toHaveBeenCalledWith('expense');
  });

  it('ignores single-key shortcuts while typing in inputs', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    fixture.detectChanges();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

    expect(quickAddTrigger).not.toHaveBeenCalled();
    input.remove();
  });

  it('clicks the visible primary action with the save shortcut', () => {
    const button = document.createElement('button');
    button.className = 'btn-primary';
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-actions';
    wrapper.appendChild(button);
    document.body.appendChild(wrapper);
    const clickSpy = vi.spyOn(button, 'click');

    fixture.componentInstance.handleGlobalKeydown(new KeyboardEvent('keydown', { key: 's', metaKey: true }));

    expect(clickSpy).toHaveBeenCalled();
    wrapper.remove();
  });
});
