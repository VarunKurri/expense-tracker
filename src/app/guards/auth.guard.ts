import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { map, take } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  return user(auth).pipe(
    take(1),
    map(currentUser => !!currentUser)
  );
};
